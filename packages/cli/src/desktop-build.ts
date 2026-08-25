import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { assert, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import type { BuildProfile } from "./config.js";
import { publishBuiltArtifact } from "./artifact-build.js";
import {
  packageManagerCommand,
  packageManagerScriptCommand,
  runProcess,
} from "./process-runner.js";
import { buildLynxBundle } from "./bundle-build.js";
import {
  inspectDesktopSigning,
  verifyDesktopArtifactSignature,
} from "./desktop-signing.js";

interface DesktopBuildOptions {
  root: string;
  profile: BuildProfile;
  uploadArtifacts?: boolean;
  skipBundleBuild?: boolean;
  allowUnsigned?: boolean;
  quiet?: boolean;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export function resolveDesktopPackScript(
  manifest: PackageJson,
  profile?: BuildProfile,
): string | undefined {
  if (profile?.desktop?.script) return profile.desktop.script;
  for (const name of ["pack", "build:desktop", "build:app"]) {
    if (manifest.scripts?.[name]) return name;
  }
  return undefined;
}

async function packageJson(root: string): Promise<PackageJson> {
  try {
    return JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as PackageJson;
  } catch {
    return {};
  }
}

export async function hasDesktopHost(
  root: string,
  profile?: BuildProfile,
): Promise<boolean> {
  const manifest = await packageJson(root);
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  const hasElectronBuilder = Boolean(
    dependencies["electron-builder"] ||
    existsSync(join(root, "electron-builder.yml")) ||
    existsSync(join(root, "electron-builder.yaml")) ||
    existsSync(join(root, "electron-builder.json")),
  );
  return Boolean(
    resolveDesktopPackScript(manifest, profile) ||
    dependencies["@lynx-js/lynxtron"] ||
    dependencies["@lynx-js/lynxtron-builder"] ||
    dependencies.lynxtron ||
    hasElectronBuilder,
  );
}

function artifactExtension(file: string): "dmg" | "exe" | "appimage" | "zip" {
  const extension = extname(file).toLowerCase();
  assert(
    extension === ".dmg" ||
      extension === ".exe" ||
      extension === ".zip" ||
      extension === ".appimage",
    "DESKTOP_ARTIFACT_INVALID",
    "Desktop packaging must produce a .dmg, .exe, .zip or AppImage file.",
  );
  return extension.slice(1) as "dmg" | "exe" | "appimage" | "zip";
}

async function findDesktopArtifact(
  root: string,
  configured?: string,
): Promise<string> {
  if (configured) {
    const file = resolve(root, configured);
    assert(
      existsSync(file),
      "DESKTOP_ARTIFACT_MISSING",
      `Configured desktop artifact was not found: ${file}`,
    );
    assert(
      (await stat(file)).isFile(),
      "DESKTOP_ARTIFACT_INVALID",
      "Configured desktop artifact must be a file, not an .app directory.",
    );
    return file;
  }
  const directories = [
    "dist",
    "release",
    "out",
    "build/electron",
    "build/dist",
    "build",
  ];
  const candidates: string[] = [];
  for (const directory of directories) {
    const absolute = join(root, directory);
    const entries = await readdir(absolute, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (/\.(?:dmg|exe|zip|appimage)$/i.test(entry.name))
        candidates.push(join(absolute, entry.name));
    }
  }
  assert(
    candidates.length === 1,
    "DESKTOP_ARTIFACT_AMBIGUOUS",
    candidates.length === 0
      ? "The desktop packager produced no distributable file. Configure a pack script or build.<profile>.desktop.artifact."
      : "The desktop packager produced multiple files. Set build.<profile>.desktop.artifact explicitly.",
  );
  return candidates[0]!;
}

export async function runRealDesktopBuild(
  job: BuildJob,
  options: DesktopBuildOptions,
): Promise<BuildJob> {
  assert(
    await hasDesktopHost(options.root, options.profile),
    "DESKTOP_HOST_REQUIRED",
    "No Lynxtron desktop host was found. Use the official Lynxtron template or configure a project pack script with @lynx-js/lynxtron-builder.",
  );
  const signing = await inspectDesktopSigning(options.root);
  if (signing.status === "missing" || signing.status === "disabled") {
    assert(
      options.allowUnsigned,
      "DESKTOP_SIGNING_REQUIRED",
      `${signing.value}. Configure a real desktop signing identity before a production build, or use --allow-unsigned together with --no-upload for local packaging tests. ${signing.fix}`,
    );
  }
  const manifest = await packageJson(options.root);
  const uploadArtifacts = options.uploadArtifacts ?? true;
  const step = (message: string, value?: number): void => {
    options.onEvent?.(message);
    options.onProgress?.(value, message);
  };
  try {
    transitionBuild(job, "uploading_source", "Desktop source prepared");
    const packScript = resolveDesktopPackScript(manifest, options.profile);
    if (!options.skipBundleBuild && !packScript) {
      step("Building Lynx desktop bundle with Rspeedy…", 10);
      await buildLynxBundle(options.root, {
        quiet: options.quiet,
        onOutput: options.onEvent,
      });
    }
    transitionBuild(job, "queued", "Desktop build queued locally");
    transitionBuild(
      job,
      "provisioning",
      "Lynxtron packaging toolchain selected",
    );
    transitionBuild(
      job,
      "installing_dependencies",
      "Desktop dependencies selected",
    );
    step("Preparing desktop package…", 30);
    if (packScript) {
      const command = packageManagerScriptCommand(options.root, packScript);
      await runProcess(command.command, command.args, {
        cwd: options.root,
        quiet: options.quiet,
        onOutput: options.onEvent,
      });
    } else {
      const manager = packageManagerCommand(options.root);
      await runProcess(
        manager.command,
        [...manager.prefix, "lynxtron-builder", "--publish", "never"],
        {
          cwd: options.root,
          quiet: options.quiet,
          onOutput: options.onEvent,
        },
      );
    }
    transitionBuild(job, "building", "Desktop package created");
    const artifact = await findDesktopArtifact(
      options.root,
      options.profile.desktop?.artifact,
    );
    const signature = await verifyDesktopArtifactSignature(artifact);
    if (!signature.signed && signature.status !== "not-required") {
      assert(
        options.allowUnsigned,
        "DESKTOP_SIGNING_REQUIRED",
        `Desktop artifact is not signed: ${signature.detail} Configure a real desktop signing identity, or use --allow-unsigned together with --no-upload for local packaging tests.`,
      );
      step(`Warning: unsigned desktop artifact accepted for local testing`, 75);
    } else if (signature.signed) {
      step("Desktop signature verified", 75);
    } else {
      step("Desktop signature verification not required for this target", 75);
    }
    return publishBuiltArtifact({
      root: options.root,
      job,
      platform: "desktop",
      artifactPath: artifact,
      extension: artifactExtension(artifact),
      contentType: "application/octet-stream",
      uploadArtifacts,
      verificationMessage: "Desktop distributable output verified",
      quiet: options.quiet,
      onEvent: options.onEvent,
      onProgress: options.onProgress,
    });
  } catch (error) {
    if (!["success", "failed", "canceled", "timed_out"].includes(job.state))
      transitionBuild(
        job,
        "failed",
        error instanceof Error ? error.message : "Desktop build failed",
      );
    job.logs.push({
      level: "error",
      message: error instanceof Error ? error.message : "Desktop build failed",
      at: new Date().toISOString(),
    });
    throw error;
  }
}
