import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { join } from "node:path";
import { assert, sha256, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import { loadR2, uploadR2Artifact } from "./r2.js";
import { nativeArtifactName } from "./artifact-name.js";
import { runProcess } from "./process-runner.js";
import { buildLynxBundle } from "./bundle-build.js";

import type { AndroidBuildOptions } from "./android/types.js";
import {
  artifactDetails,
  createSigningInitScript,
  signingEnvironment,
  verifySignedArtifact,
} from "./android/signing.js";

export function hasAndroidHost(root: string): Promise<boolean> {
  if (!isSupportedAndroidPlatform()) return Promise.resolve(false);
  const wrapper = join(
    root,
    "android",
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );
  return access(
    wrapper,
    process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
  )
    .then(() => true)
    .catch(() => false);
}

export function isSupportedAndroidPlatform(): boolean {
  return ["linux", "darwin", "win32"].includes(process.platform);
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
  assert(
    isSupportedAndroidPlatform(),
    "ANDROID_PLATFORM_UNSUPPORTED",
    "Android builds are supported only on Linux, macOS and Windows.",
  );
  const android = join(options.root, "android");
  const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const artifact = artifactDetails(options.root, options.profile);
  const uploadArtifacts = options.uploadArtifacts ?? true;
  if (uploadArtifacts) await loadR2(options.root);
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
  let signingInitDirectory: string | undefined;
  try {
    transitionBuild(job, "uploading_source", "local Android source prepared");
    job.logs.push({
      level: "info",
      message: "rspeedy:build",
      at: new Date().toISOString(),
    });
    if (options.skipBundleBuild) {
      step("Using shared Lynx bundle", 20);
    } else {
      step("Building Lynx bundle with Rspeedy…");
      await buildLynxBundle(options.root, {
        env: environment,
        ...processOptions,
        miso: options.profile.miso,
      });
    }
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
    step("Applying temporary LynxShip Android signing adapter…");
    const signingInitScript = await createSigningInitScript();
    signingInitDirectory = signingInitScript.directory;
    const gradleArgs = ["--init-script", signingInitScript.file, artifact.task];
    if (process.env.CI) gradleArgs.push("--stacktrace");
    await runProcess(wrapper, gradleArgs, {
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
    const contentType = artifactName.endsWith(".aab")
      ? "application/octet-stream"
      : "application/vnd.android.package-archive";
    if (!uploadArtifacts) {
      step("Artifact collected locally; R2 upload skipped", 100);
      job.artifact = {
        name: artifactName,
        hash,
        path: artifactPath,
        size: content.length,
        contentType,
      };
    } else {
      step("Uploading signed artifact to Cloudflare R2…", 80);
      const uploaded = await uploadR2Artifact(
        options.root,
        job.projectId,
        job.id,
        artifactPath,
        contentType,
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
    }
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
  } finally {
    if (signingInitDirectory)
      await rm(signingInitDirectory, { recursive: true, force: true });
  }
}
