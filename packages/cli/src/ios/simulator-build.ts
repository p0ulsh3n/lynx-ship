import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assert, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import { nativeArtifactName } from "../artifact-name.js";
import {
  captureProcess,
  commandExists,
  runProcess,
} from "../process-runner.js";
import { buildLynxBundle } from "../bundle-build.js";

import type { IosBuildOptions } from "./types.js";
import {
  ensureSimulatorBooted,
  findSimulatorApp,
  selectSimulatorDevice,
} from "./simulator.js";
import { prepareIosAppIcon, syncIosRuntimeResources } from "./assets.js";
import { findProject, installCocoaPods } from "./project.js";

async function appBundleIdentifier(
  root: string,
  appBundle: string,
): Promise<string> {
  assert(
    commandExists("plutil"),
    "IOS_PLUTIL_REQUIRED",
    "plutil was not found. Install Xcode command-line tools before launching the Simulator app.",
  );
  const result = await captureProcess(
    "plutil",
    [
      "-extract",
      "CFBundleIdentifier",
      "raw",
      "-o",
      "-",
      join(appBundle, "Info.plist"),
    ],
    { cwd: root },
  );
  const identifier = result.stdout.trim();
  assert(
    result.code === 0 && identifier,
    "IOS_BUNDLE_IDENTIFIER_MISSING",
    `Could not read CFBundleIdentifier from ${join(appBundle, "Info.plist")}.`,
  );
  return identifier;
}

export async function launchIosSimulatorApp(
  root: string,
  device: string,
  appBundle: string,
  options: {
    quiet?: boolean;
    onEvent?: (message: string) => void;
  } = {},
): Promise<void> {
  const identifier = await appBundleIdentifier(root, appBundle);
  options.onEvent?.("Opening iOS Simulator…");
  await runProcess("open", ["-a", "Simulator"], {
    cwd: root,
    quiet: options.quiet,
    onOutput: options.onEvent,
  });
  options.onEvent?.(`Launching ${identifier} in iOS Simulator…`);
  await runProcess("xcrun", ["simctl", "launch", device, identifier], {
    cwd: root,
    quiet: options.quiet,
    onOutput: options.onEvent,
  });
}

async function hashDirectory(directory: string): Promise<{
  hash: string;
  size: number;
}> {
  const hash = createHash("sha256");
  let size = 0;

  async function visit(current: string, relative: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`dir:${entryRelative}\n`);
        await visit(entryPath, entryRelative);
      } else {
        const content = await readFile(entryPath);
        size += content.length;
        hash.update(`file:${entryRelative}:${content.length}\n`);
        hash.update(content.toString("latin1"), "latin1");
      }
    }
  }

  await visit(directory, "");
  return { hash: hash.digest("hex"), size };
}

export async function runRealIosSimulatorBuild(
  job: BuildJob,
  options: IosBuildOptions,
): Promise<BuildJob> {
  assert(
    process.platform === "darwin",
    "IOS_MACOS_REQUIRED",
    "iOS Simulator builds require macOS with Xcode",
  );
  assert(
    commandExists("xcodebuild"),
    "IOS_XCODE_REQUIRED",
    "xcodebuild was not found. Install Xcode and select its command-line tools.",
  );
  assert(
    commandExists("xcrun"),
    "IOS_XCRUN_REQUIRED",
    "xcrun was not found. Install Xcode command-line tools.",
  );
  const project = findProject(options.root, options.profile);
  const ios = options.profile.ios ?? {};
  assert(
    ios.scheme,
    "IOS_SCHEME_REQUIRED",
    "Configure ios.scheme in the selected Simulator build profile",
  );
  const projectFlag = project.endsWith(".xcworkspace")
    ? "-workspace"
    : "-project";
  const configuration = ios.configuration ?? "Debug";
  const device = await selectSimulatorDevice(
    options.root,
    options.simulatorDevice,
  );
  await installCocoaPods(options.root, options.quiet, options.onEvent);
  const directory = join(options.root, ".lynxship", "ios", job.id, "simulator");
  const derivedData = join(directory, "derived-data");
  const step = (message: string, progress?: number): void => {
    options.onEvent?.(message);
    options.onProgress?.(progress, message);
  };
  try {
    assert(
      options.uploadArtifacts !== true,
      "IOS_SIMULATOR_UPLOAD_BLOCKED",
      "iOS Simulator .app builds stay local. Use --no-upload; simulator artifacts are not store artifacts.",
    );
    await mkdir(directory, { recursive: true });
    transitionBuild(job, "uploading_source", "iOS Simulator source prepared");
    if (options.skipBundleBuild) {
      step("Using shared Lynx bundle", 5);
    } else {
      step("Building Lynx bundle with Rspeedy…", 5);
      await buildLynxBundle(options.root, {
        quiet: options.quiet,
        onOutput: options.onEvent,
        miso: options.profile.miso,
      });
    }
    if (ios.bundleScript) {
      step("Syncing bundle into the iOS host…", 8);
      await runProcess(
        process.execPath,
        [resolve(options.root, ios.bundleScript)],
        {
          cwd: options.root,
          quiet: options.quiet,
          onOutput: options.onEvent,
        },
      );
    }
    const icon = await prepareIosAppIcon(options.root, ios.appIcon, {
      allowFallback: true,
    });
    if (icon) step(`Using iOS app icon: ${icon}`, 9);
    else
      options.onEvent?.(
        "No 1024x1024 PNG app icon was found; configure ios.appIcon or add icon.png before distribution.",
      );
    transitionBuild(job, "queued", "iOS Simulator build queued locally");
    transitionBuild(job, "provisioning", "iOS Simulator destination selected");
    transitionBuild(
      job,
      "installing_dependencies",
      "iOS Simulator dependencies ready",
    );
    await ensureSimulatorBooted(
      options.root,
      device,
      options.onEvent,
      options.quiet,
    );
    step("Building iOS Simulator .app…", 15);
    transitionBuild(job, "building", "iOS Simulator build started");
    await runProcess(
      "xcodebuild",
      [
        projectFlag,
        project,
        "-scheme",
        ios.scheme,
        "-configuration",
        configuration,
        "-sdk",
        "iphonesimulator",
        "-destination",
        `id=${device}`,
        "-derivedDataPath",
        derivedData,
        "CODE_SIGNING_ALLOWED=NO",
        "CODE_SIGNING_REQUIRED=NO",
        "build",
      ],
      { cwd: options.root, quiet: options.quiet, onOutput: options.onEvent },
    );
    const appPath = await findSimulatorApp(
      derivedData,
      configuration,
      ios.scheme,
    );
    const copiedResources = await syncIosRuntimeResources(
      options.root,
      appPath,
    );
    for (const name of copiedResources)
      options.onEvent?.(`Packaged ${name} in the iOS Simulator app`);
    step("Installing .app in iOS Simulator…", 75);
    await runProcess("xcrun", ["simctl", "install", device, appPath], {
      cwd: options.root,
      quiet: options.quiet,
      onOutput: options.onEvent,
    });
    if (options.simulatorAutostart) {
      try {
        await launchIosSimulatorApp(options.root, device, appPath, {
          quiet: options.quiet,
          onEvent: options.onEvent,
        });
      } catch (error) {
        options.onEvent?.(
          `Simulator app installed but could not be launched automatically: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const artifact = await hashDirectory(appPath);
    const artifactName = nativeArtifactName("app");
    job.attempts += 1;
    job.artifact = {
      name: artifactName,
      hash: artifact.hash,
      path: appPath,
      size: artifact.size,
      contentType: "application/octet-stream",
    };
    transitionBuild(job, "signing", "Simulator app verification completed");
    transitionBuild(
      job,
      "uploading_artifacts",
      "Simulator app collected locally",
    );
    step(`Simulator app ready: ${artifactName}`, 100);
    return transitionBuild(job, "success", "iOS Simulator app created");
  } catch (error) {
    if (!["success", "failed", "canceled", "timed_out"].includes(job.state))
      transitionBuild(
        job,
        "failed",
        error instanceof Error ? error.message : "iOS Simulator build failed",
      );
    job.logs.push({
      level: "error",
      message:
        error instanceof Error ? error.message : "iOS Simulator build failed",
      at: new Date().toISOString(),
    });
    throw error;
  }
}
