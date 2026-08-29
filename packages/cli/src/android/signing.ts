import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert } from "@lynxship/contracts";
import type { BuildProfile } from "../config.js";
import { loadCredentials } from "../secure-store.js";
import {
  commandExists,
  executableExists,
  runProcess,
} from "../process-runner.js";

export async function signingEnvironment(
  root: string,
): Promise<NodeJS.ProcessEnv> {
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

export async function createSigningInitScript(): Promise<{
  directory: string;
  file: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "lynxship-gradle-"));
  const file = join(directory, "android-signing.init.gradle");
  const script = `
def keystorePath = System.getenv("LYNXSHIP_KEYSTORE_PATH")
def keyAlias = System.getenv("LYNXSHIP_KEY_ALIAS")
def keystorePassword = System.getenv("LYNXSHIP_KEYSTORE_PASSWORD")
def keyPassword = System.getenv("LYNXSHIP_KEY_PASSWORD")

gradle.allprojects { project ->
    project.plugins.withId("com.android.application") {
        def configureSigning = { android ->
            def signing = android.signingConfigs.findByName("release")
            if (signing == null) {
                signing = android.signingConfigs.create("lynxshipRelease")
            }
            signing.storeFile = project.file(keystorePath)
            signing.storePassword = keystorePassword
            signing.keyAlias = keyAlias
            signing.keyPassword = keyPassword

            def release = android.buildTypes.findByName("release")
            if (release == null) {
                throw new GradleException(
                    "LynxShip requires an Android release build type"
                )
            }
            release.signingConfig = signing
            project.logger.lifecycle(
                "[LynxShip] Applied machine signing credentials to \${project.path}:release"
            )
        }

        def androidComponents = project.extensions.findByName("androidComponents")
        if (androidComponents != null) {
            androidComponents.finalizeDsl { android ->
                configureSigning(android)
            }
        } else {
            project.afterEvaluate {
                configureSigning(project.extensions.findByName("android"))
            }
        }
    }
}
`;
  await writeFile(file, script, "utf8");
  await chmod(file, 0o600).catch(() => undefined);
  return { directory, file };
}

export async function verifySignedArtifact(
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

export function androidTool(name: string): string | undefined {
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
      .find((candidate) => executableExists(candidate));
  } catch {
    return undefined;
  }
}

export function artifactDetails(
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
