import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, sha256, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import type { BuildProfile } from "./config.js";
import { loadR2, uploadR2Artifact } from "./r2.js";
import { loadCredentials } from "./secure-store.js";
import { nativeArtifactName } from "./artifact-name.js";
import {
  commandExists,
  packageManagerScriptCommand,
  runProcess,
} from "./process-runner.js";

interface AndroidBuildOptions {
  root: string;
  profile: BuildProfile;
  quiet?: boolean;
  onStep?: (message: string) => void;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
}

async function projectBuildCommand(root: string): Promise<string[]> {
  try {
    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    if (packageJson.scripts?.["build:mobile"]) return ["run", "build:mobile"];
  } catch {
    // The package manager will report the useful project error below.
  }
  return ["run", "build"];
}

async function signingEnvironment(root: string): Promise<NodeJS.ProcessEnv> {
  const android = (await loadCredentials(root)).android;
  const values = {
    LYNXSHIP_KEYSTORE_PATH:
      process.env.LYNXSHIP_KEYSTORE_PATH ?? android?.keystorePath,
    LYNXSHIP_KEY_ALIAS: process.env.LYNXSHIP_KEY_ALIAS ?? android?.keyAlias,
    LYNXSHIP_KEYSTORE_PASSWORD:
      process.env.LYNXSHIP_KEYSTORE_PASSWORD ?? android?.keystorePassword,
    LYNXSHIP_KEY_PASSWORD:
      process.env.LYNXSHIP_KEY_PASSWORD ?? android?.keyPassword,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  assert(
    missing.length === 0,
    "BUILD_SIGNING_REQUIRED",
    `Signed Android builds require configuration. Missing: ${missing.join(", ")}. Run \`lynxship android configure\`.`,
  );
  return { ...process.env, ...values };
}

async function verifySignedArtifact(
  root: string,
  artifactPath: string,
  options: { quiet: boolean; onOutput?: (line: string) => void },
): Promise<void> {
  if (artifactPath.endsWith(".apk")) {
    const apksigner = androidTool("apksigner");
    assert(
      apksigner,
      "ANDROID_APKSIGNER_REQUIRED",
      "apksigner was not found in PATH. Install the Android SDK Build Tools.",
    );
    await runProcess(apksigner, ["verify", "--verbose", artifactPath], {
      cwd: root,
      ...options,
    });
    return;
  }
  const jarsigner = commandExists("jarsigner") ? "jarsigner" : undefined;
  assert(
    jarsigner,
    "ANDROID_JARSIGNER_REQUIRED",
    "jarsigner was not found in PATH. Install JDK 17.",
  );
  await runProcess(jarsigner, ["-verify", "-verbose", "-certs", artifactPath], {
    cwd: root,
    ...options,
  });
}

function androidTool(name: string): string | undefined {
  if (commandExists(name)) {
    if (process.platform !== "win32") return name;
    try {
      return execFileSync("where.exe", [name], { encoding: "utf8" })
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find(Boolean);
    } catch {
      return name;
    }
  }
  const sdk =
    process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME ?? undefined;
  if (!sdk) return undefined;
  const executable = process.platform === "win32" ? `${name}.bat` : name;
  try {
    return readdirSync(join(sdk, "build-tools"))
      .sort()
      .reverse()
      .map((version) => join(sdk, "build-tools", version, executable))
      .find((candidate) => existsSync(candidate));
  } catch {
    return undefined;
  }
}

function artifactDetails(
  root: string,
  profile: BuildProfile,
): { task: string; path: string } {
  const artifact = profile.android?.artifact ?? "apk";
  assert(
    artifact === "apk" || artifact === "aab",
    "BUILD_ARTIFACT_INVALID",
    "Android artifact must be apk or aab",
  );
  return artifact === "aab"
    ? {
        task: "bundleRelease",
        path: join(
          root,
          "android",
          "app",
          "build",
          "outputs",
          "bundle",
          "release",
          "app-release.aab",
        ),
      }
    : {
        task: "assembleRelease",
        path: join(
          root,
          "android",
          "app",
          "build",
          "outputs",
          "apk",
          "release",
          "app-release.apk",
        ),
      };
}

export function hasAndroidHost(root: string): Promise<boolean> {
  return access(
    join(
      root,
      "android",
      process.platform === "win32" ? "gradlew.bat" : "gradlew",
    ),
  )
    .then(() => true)
    .catch(() => false);
}

/**
 * Copy the standard Rspeedy output into the Android host assets directory.
 *
 * This is intentionally handled by LynxShip instead of requiring every
 * project to carry a helper script. Rspeedy writes bundles and static assets
 * to `dist`, while the Lynx Android host reads them from `app/src/main/assets`.
 */
export async function syncLynxAssets(root: string): Promise<string[]> {
  const distRoot = join(root, "dist");
  const assetsRoot = join(root, "android", "app", "src", "main", "assets");
  let entries;

  try {
    entries = await readdir(distRoot, { withFileTypes: true });
  } catch {
    throw new Error(
      `Rspeedy output directory is missing: ${distRoot}. Run the project build first.`,
    );
  }

  const bundles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".lynx.bundle"))
    .map((entry) => entry.name);
  assert(
    bundles.length > 0,
    "LYNX_BUNDLE_MISSING",
    `No .lynx.bundle was found in ${distRoot}. Check the Rspeedy output configuration.`,
  );

  await mkdir(assetsRoot, { recursive: true });
  const outputNames = [...bundles, "async", "static"];
  const copied: string[] = [];

  for (const name of outputNames) {
    const source = join(distRoot, name);
    if (!existsSync(source)) continue;

    await cp(source, join(assetsRoot, name), {
      force: true,
      recursive: true,
    });
    copied.push(name);
  }

  return copied;
}

export async function runRealAndroidBuild(
  job: BuildJob,
  options: AndroidBuildOptions,
): Promise<BuildJob> {
  const android = join(options.root, "android");
  const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const artifact = artifactDetails(options.root, options.profile);
  await loadR2(options.root);
  const environment = {
    ...(await signingEnvironment(options.root)),
    LYNXSHIP_RUNTIME_VERSION:
      process.env.LYNXSHIP_RUNTIME_VERSION ?? job.runtimeVersion ?? "",
  };

  const step = (message: string, progress?: number): void => {
    options.onStep?.(message);
    options.onEvent?.(message);
    if (progress !== undefined) options.onProgress?.(progress, message);
  };
  const processOptions = {
    quiet: options.quiet ?? false,
    onOutput: options.onEvent,
  };
  try {
    transitionBuild(job, "uploading_source", "local Android source prepared");
    job.logs.push({
      level: "info",
      message: "rspeedy:build",
      at: new Date().toISOString(),
    });
    step("Building Lynx bundle with Rspeedy…");
    const packageManager = packageManagerScriptCommand(
      options.root,
      (await projectBuildCommand(options.root))[1] ?? "build",
    );
    await runProcess(packageManager.command, packageManager.args, {
      cwd: options.root,
      env: environment,
      ...processOptions,
    });
    step("Rspeedy bundle ready", 20);

    transitionBuild(job, "queued", "Android build queued locally");
    step("Build queued…");
    transitionBuild(job, "provisioning", "local Android toolchain selected");
    step("Checking Android SDK and Gradle toolchain…");
    transitionBuild(
      job,
      "installing_dependencies",
      "syncing Lynx bundle into Android assets",
    );
    step("Syncing bundle into the Android host…");
    const copiedAssets = await syncLynxAssets(options.root);
    for (const name of copiedAssets) {
      options.onEvent?.(
        `Synced dist/${name} -> android/app/src/main/assets/${name}`,
      );
    }
    step("Android host synchronized", 40);

    transitionBuild(job, "building", `Gradle ${artifact.task}`);
    step(`Running real Gradle task ${artifact.task}…`);
    await runProcess(wrapper, [artifact.task], {
      cwd: android,
      env: environment,
      ...processOptions,
    });
    step(`Gradle ${artifact.task} completed`, 60);

    transitionBuild(job, "signing", "Gradle release signing completed");
    step("Verifying Android release signature…");
    await verifySignedArtifact(options.root, artifact.path, processOptions);
    step("Android release signature verified", 75);
    transitionBuild(job, "uploading_artifacts", "local artifact collected");
    const artifactName = nativeArtifactName(
      artifact.path.endsWith(".aab") ? "aab" : "apk",
    );
    const artifactDirectory = join(options.root, ".lynxship", "artifacts");
    const artifactPath = join(artifactDirectory, artifactName);
    await mkdir(artifactDirectory, { recursive: true });
    await copyFile(artifact.path, artifactPath);
    const content = await readFile(artifactPath);
    const hash = sha256(content);
    job.attempts += 1;
    step("Uploading signed artifact to Cloudflare R2…", 80);
    const uploaded = await uploadR2Artifact(
      options.root,
      job.projectId,
      job.id,
      artifactPath,
      artifactName.endsWith(".aab")
        ? "application/octet-stream"
        : "application/vnd.android.package-archive",
      undefined,
      {
        onProgress: (uploadedBytes, totalBytes) => {
          const transfer = totalBytes === 0 ? 1 : uploadedBytes / totalBytes;
          options.onProgress?.(
            80 + transfer * 19,
            `Uploading signed artifact to Cloudflare R2… ${Math.round(transfer * 10000) / 100}%`,
          );
        },
      },
    );
    assert(
      uploaded.hash === hash,
      "BUILD_ARTIFACT_HASH",
      "R2 artifact hash mismatch",
    );
    job.artifact = {
      name: artifactName,
      hash,
      path: artifactPath,
      key: uploaded.key,
      size: uploaded.size,
      contentType: uploaded.contentType,
      url: uploaded.url,
      expiresAt: uploaded.expiresAt,
    };
    step(`Artifact ready: ${artifactName}`, 100);
    return transitionBuild(job, "success", "real Android artifact created");
  } catch (error) {
    if (!["success", "failed", "canceled", "timed_out"].includes(job.state)) {
      transitionBuild(
        job,
        "failed",
        error instanceof Error ? error.message : "Android build failed",
      );
    }
    job.logs.push({
      level: "error",
      message: error instanceof Error ? error.message : "Android build failed",
      at: new Date().toISOString(),
    });
    throw error;
  }
}
