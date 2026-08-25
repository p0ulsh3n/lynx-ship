import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, sha256, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import type { BuildProfile } from "./config.js";
import { loadR2, uploadR2Artifact } from "./r2.js";
import { nativeArtifactName } from "./artifact-name.js";
import { captureProcess, commandExists, runProcess } from "./process-runner.js";
import { buildLynxBundle } from "./bundle-build.js";

interface IosBuildOptions {
  root: string;
  profile: BuildProfile;
  uploadArtifacts?: boolean;
  simulator?: boolean;
  simulatorDevice?: string;
  simulatorAutostart?: boolean;
  skipBundleBuild?: boolean;
  quiet?: boolean;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
}

interface SimulatorDevice {
  udid: string;
  state: string;
  isAvailable?: boolean;
}

async function listSimulatorDevices(
  root: string,
  filter: "booted" | "available",
): Promise<SimulatorDevice[]> {
  const result = await captureProcess(
    "xcrun",
    ["simctl", "list", "devices", filter, "--json"],
    { cwd: root },
  );
  if (result.code !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout) as {
      devices?: Record<string, SimulatorDevice[]>;
    };
    return Object.values(parsed.devices ?? {}).flat();
  } catch {
    return [];
  }
}

async function selectSimulatorDevice(
  root: string,
  requested?: string,
): Promise<string> {
  if (requested) return requested;
  const booted = (await listSimulatorDevices(root, "booted"))[0];
  if (booted) return booted.udid;
  const available = (await listSimulatorDevices(root, "available")).find(
    (device) => device.isAvailable !== false,
  );
  assert(
    available,
    "IOS_SIMULATOR_RUNTIME_REQUIRED",
    "No available iOS Simulator device was found. Install an iOS Simulator runtime in Xcode, then rerun the build.",
  );
  return available.udid;
}

async function ensureSimulatorBooted(
  root: string,
  device: string,
  onEvent?: (message: string) => void,
  quiet?: boolean,
): Promise<void> {
  const booted = (await listSimulatorDevices(root, "booted")).some(
    (entry) => entry.udid === device,
  );
  if (!booted) {
    onEvent?.(`Booting iOS Simulator ${device}…`);
    await runProcess("xcrun", ["simctl", "boot", device], {
      cwd: root,
      quiet,
      onOutput: onEvent,
    });
  }
  await runProcess("xcrun", ["simctl", "bootstatus", device, "-b"], {
    cwd: root,
    quiet,
    onOutput: onEvent,
  });
}

async function findSimulatorApp(
  root: string,
  derivedData: string,
  configuration: string,
  scheme: string,
): Promise<string> {
  const products = join(
    derivedData,
    "Build",
    "Products",
    `${configuration}-iphonesimulator`,
  );
  const expected = join(products, `${scheme}.app`);
  if (existsSync(expected)) return expected;
  const entries = await readdir(products, { withFileTypes: true }).catch(
    () => [],
  );
  const app = entries.find(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
  );
  assert(
    app,
    "IOS_SIMULATOR_ARTIFACT_MISSING",
    `Xcode did not produce a Simulator .app under ${products}`,
  );
  return join(products, app.name);
}

async function findArchiveApp(archivePath: string): Promise<string> {
  const products = join(archivePath, "Products", "Applications");
  const entries = await readdir(products, { withFileTypes: true }).catch(
    () => [],
  );
  const app = entries.find(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
  );
  assert(
    app,
    "IOS_ARCHIVE_ARTIFACT_MISSING",
    `Xcode did not produce an app bundle under ${products}`,
  );
  return join(products, app.name);
}

async function copyIosOutput(source: string, target: string): Promise<boolean> {
  if (!existsSync(source)) return false;
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true, force: true });
  return true;
}

/**
 * Rspeedy leaves external resources beside the Lynx bundle. Xcode does not
 * know about those generated files, so copy the complete output into the
 * final app bundle after the native host has been compiled. This also makes
 * older LynxShip-generated iOS hosts behave correctly without editing their
 * Xcode project files.
 */
export async function syncIosRuntimeResources(
  root: string,
  appBundle: string,
): Promise<string[]> {
  const distRoot = join(root, "dist");
  const entries = await readdir(distRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const bundles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".lynx.bundle"))
    .map((entry) => entry.name);
  assert(
    bundles.length > 0,
    "LYNX_BUNDLE_MISSING",
    `No .lynx.bundle was found in ${distRoot}. Check the Rspeedy output configuration.`,
  );

  const copied: string[] = [];
  for (const name of [...bundles, "async", "static"]) {
    if (await copyIosOutput(join(distRoot, name), join(appBundle, name)))
      copied.push(name);
  }
  return copied;
}

async function findAppIconSet(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name === "AppIcon.appiconset") {
      if (existsSync(join(path, "Contents.json"))) return path;
    }
    if (
      entry.isDirectory() &&
      !entry.name.endsWith(".xcodeproj") &&
      !entry.name.endsWith(".xcworkspace")
    ) {
      const result = await findAppIconSet(path);
      if (result) return result;
    }
  }
  return undefined;
}

function pngDimensions(content: Buffer): { width: number; height: number } {
  assert(
    content.length >= 24 &&
      content.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    "IOS_APP_ICON_INVALID",
    "The iOS app icon must be a valid PNG file.",
  );
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
}

async function findConfiguredIosIcon(
  root: string,
  configured?: string,
  allowFallback = false,
): Promise<{ path: string; fallback: boolean } | undefined> {
  const candidates = [
    configured,
    "icon.png",
    "app-icon.png",
    "assets/icon.png",
    "assets/app-icon.png",
    "src/assets/icon.png",
    "src/assets/app-icon.png",
    "public/icon.png",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const path = resolve(root, candidate);
    if (existsSync(path)) return { path, fallback: false };
  }
  if (allowFallback) {
    const staticImages = join(root, "dist", "static", "image");
    const entries = await readdir(staticImages, { withFileTypes: true }).catch(
      () => [],
    );
    const logo = entries.find(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".png") &&
        /(?:lynx|logo|icon)/i.test(entry.name),
    );
    if (logo) return { path: join(staticImages, logo.name), fallback: true };
  }
  return undefined;
}

/**
 * Apply a project-owned 1024x1024 PNG to the generated or existing Xcode
 * AppIcon set. A missing icon is reported as a warning by the caller rather
 * than silently inventing product branding.
 */
export async function prepareIosAppIcon(
  root: string,
  configured?: string,
  options: { allowFallback?: boolean } = {},
): Promise<string | undefined> {
  const source = await findConfiguredIosIcon(
    root,
    configured,
    options.allowFallback,
  );
  const iconSet = await findAppIconSet(join(root, "ios"));
  if (!source || !iconSet) return undefined;
  const dimensions = pngDimensions(await readFile(source.path));
  const filename = "AppIcon.png";
  const destination = join(iconSet, filename);
  if (dimensions.width === 1024 && dimensions.height === 1024) {
    await copyFile(source.path, destination);
  } else {
    assert(
      source.fallback &&
        dimensions.width === dimensions.height &&
        dimensions.width >= 512,
      "IOS_APP_ICON_INVALID",
      `The iOS app icon must be exactly 1024x1024 PNG; received ${dimensions.width}x${dimensions.height} from ${source.path}.`,
    );
    assert(
      commandExists("sips"),
      "IOS_SIPS_REQUIRED",
      "The fallback Simulator icon needs Apple's sips tool. Install Xcode command-line tools, or provide a 1024x1024 icon.png.",
    );
    await runProcess(
      "sips",
      ["-z", "1024", "1024", source.path, "--out", destination],
      {
        cwd: root,
        quiet: true,
      },
    );
  }
  await writeFile(
    join(iconSet, "Contents.json"),
    `${JSON.stringify(
      {
        images: [
          {
            filename,
            idiom: "universal",
            platform: "ios",
            size: "1024x1024",
          },
        ],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return source.path;
}

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

async function runRealIosSimulatorBuild(
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
      options.root,
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

export function hasIosHost(root: string, profile?: BuildProfile): boolean {
  if (process.platform !== "darwin") return false;
  const configured = profile?.ios?.workspace ?? profile?.ios?.project;
  if (configured && existsSync(resolve(root, configured))) return true;
  return ["ios", "macos"].some((directory) => {
    try {
      return readdirSync(join(root, directory)).some(
        (name: string) =>
          name.endsWith(".xcworkspace") || name.endsWith(".xcodeproj"),
      );
    } catch {
      return false;
    }
  });
}

function findProject(root: string, profile: BuildProfile): string {
  const configured = profile.ios?.workspace ?? profile.ios?.project;
  if (configured) {
    const configuredPath = resolve(root, configured);
    if (configuredPath.endsWith(".xcodeproj")) {
      const workspace = configuredPath.replace(/\.xcodeproj$/, ".xcworkspace");
      if (existsSync(workspace)) return workspace;
    }
    return configuredPath;
  }
  for (const directory of ["ios", "macos"]) {
    try {
      const candidate = readdirSync(join(root, directory)).find(
        (name: string) =>
          name.endsWith(".xcworkspace") || name.endsWith(".xcodeproj"),
      );
      if (candidate) return join(root, directory, candidate);
    } catch {
      // The platform host is optional until an iOS/macOS build is requested.
    }
  }
  throw new Error("No Xcode workspace or project found under ios/ or macos/");
}

async function installCocoaPods(
  root: string,
  quiet: boolean | undefined,
  onEvent: ((message: string) => void) | undefined,
): Promise<void> {
  const iosDirectory = join(root, "ios");
  const podfile = join(iosDirectory, "Podfile");
  if (!existsSync(podfile)) return;
  assert(
    commandExists("pod"),
    "IOS_COCOAPODS_REQUIRED",
    "CocoaPods was not found. Install CocoaPods on macOS, then rerun the build.",
  );
  const hasLockfile = existsSync(join(iosDirectory, "Podfile.lock"));
  onEvent?.(
    hasLockfile
      ? "Installing iOS CocoaPods dependencies…"
      : "Updating CocoaPods specs and installing iOS dependencies…",
  );
  await runProcess(
    "pod",
    hasLockfile ? ["install"] : ["install", "--repo-update"],
    {
      cwd: iosDirectory,
      quiet,
      onOutput: onEvent,
    },
  );
}

async function findIpa(directory: string): Promise<string> {
  const files = await readdir(directory, { withFileTypes: true });
  const ipa = files.find((file) => file.isFile() && file.name.endsWith(".ipa"));
  if (!ipa) throw new Error(`xcodebuild exported no IPA in ${directory}`);
  return join(directory, ipa.name);
}

export async function runRealIosBuild(
  job: BuildJob,
  options: IosBuildOptions,
): Promise<BuildJob> {
  if (options.simulator) return runRealIosSimulatorBuild(job, options);
  assert(
    process.platform === "darwin",
    "IOS_MACOS_REQUIRED",
    "iOS builds require macOS with Xcode",
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
  assert(
    existsSync(project),
    "IOS_PROJECT_REQUIRED",
    `Configured Xcode project was not found: ${project}`,
  );
  await installCocoaPods(options.root, options.quiet, options.onEvent);
  const resolvedProject = findProject(options.root, options.profile);
  const ios = options.profile.ios ?? {};
  const scheme = ios.scheme;
  assert(
    scheme,
    "IOS_SCHEME_REQUIRED",
    "Configure build.<profile>.ios.scheme in lynxship.json",
  );
  const exportOptions = ios.exportOptionsPlist;
  assert(
    exportOptions,
    "IOS_EXPORT_OPTIONS_REQUIRED",
    "Configure build.<profile>.ios.exportOptionsPlist for a signed IPA export",
  );
  const exportOptionsPath = resolve(options.root, exportOptions);
  assert(
    existsSync(exportOptionsPath),
    "IOS_EXPORT_OPTIONS_REQUIRED",
    `Export options file was not found: ${exportOptionsPath}`,
  );
  const projectFlag = resolvedProject.endsWith(".xcworkspace")
    ? "-workspace"
    : "-project";
  const configuration = ios.configuration ?? "Release";
  const archiveDirectory = join(options.root, ".lynxship", "ios", job.id);
  const archivePath = join(archiveDirectory, `${job.id}.xcarchive`);
  const exportPath = join(archiveDirectory, "export");
  const step = (message: string, progress?: number): void => {
    options.onEvent?.(message);
    options.onProgress?.(progress, message);
  };
  try {
    const uploadArtifacts = options.uploadArtifacts ?? true;
    if (uploadArtifacts) await loadR2(options.root);
    await mkdir(archiveDirectory, { recursive: true });
    transitionBuild(job, "uploading_source", "iOS source prepared");
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
    const icon = await prepareIosAppIcon(options.root, ios.appIcon);
    if (icon) step(`Using iOS app icon: ${icon}`, 9);
    else
      options.onEvent?.(
        "No 1024x1024 PNG app icon was found; configure ios.appIcon or add icon.png before distribution.",
      );
    step("Preparing Xcode archive…", 10);
    await runProcess(
      "xcodebuild",
      [
        projectFlag,
        resolvedProject,
        "-scheme",
        scheme,
        "-configuration",
        configuration,
        "-sdk",
        "iphoneos",
        "-archivePath",
        archivePath,
        "archive",
      ],
      { cwd: options.root, quiet: options.quiet, onOutput: options.onEvent },
    );
    const archivedApp = await findArchiveApp(archivePath);
    const copiedResources = await syncIosRuntimeResources(
      options.root,
      archivedApp,
    );
    for (const name of copiedResources)
      options.onEvent?.(`Packaged ${name} in the iOS archive`);
    transitionBuild(job, "queued", "iOS build queued locally");
    transitionBuild(
      job,
      "provisioning",
      "Xcode signing configuration selected",
    );
    step("Exporting signed IPA…", 55);
    await runProcess(
      "xcodebuild",
      [
        "-exportArchive",
        "-archivePath",
        archivePath,
        "-exportOptionsPlist",
        exportOptionsPath,
        "-exportPath",
        exportPath,
      ],
      { cwd: options.root, quiet: options.quiet, onOutput: options.onEvent },
    );
    transitionBuild(job, "installing_dependencies", "iOS archive exported");
    transitionBuild(job, "building", "IPA package created");
    const exportedIpa = await findIpa(exportPath);
    transitionBuild(job, "signing", "Xcode signed the IPA");
    step("Verifying IPA signature…", 75);
    await verifyIpa(options.root, exportedIpa, archiveDirectory);
    transitionBuild(job, "uploading_artifacts", "iOS artifact collected");
    const artifactName = nativeArtifactName("ipa");
    const artifactPath = join(
      options.root,
      ".lynxship",
      "artifacts",
      artifactName,
    );
    await mkdir(join(options.root, ".lynxship", "artifacts"), {
      recursive: true,
    });
    await copyFile(exportedIpa, artifactPath);
    const content = await readFile(artifactPath);
    const hash = sha256(content);
    job.attempts += 1;
    if (!uploadArtifacts) {
      step("Artifact collected locally; R2 upload skipped", 100);
      job.artifact = {
        name: artifactName,
        hash,
        path: artifactPath,
        size: content.length,
        contentType: "application/octet-stream",
      };
    } else {
      step("Uploading signed artifact to Cloudflare R2…", 80);
      const uploaded = await uploadR2Artifact(
        options.root,
        job.projectId,
        job.id,
        artifactPath,
        "application/octet-stream",
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
    return transitionBuild(job, "success", "real iOS artifact created");
  } catch (error) {
    if (!["success", "failed", "canceled", "timed_out"].includes(job.state))
      transitionBuild(
        job,
        "failed",
        error instanceof Error ? error.message : "iOS build failed",
      );
    job.logs.push({
      level: "error",
      message: error instanceof Error ? error.message : "iOS build failed",
      at: new Date().toISOString(),
    });
    throw error;
  }
}

async function verifyIpa(
  root: string,
  ipa: string,
  directory: string,
): Promise<void> {
  const extracted = join(directory, "verified-payload");
  await mkdir(extracted, { recursive: true });
  await runProcess("unzip", ["-q", ipa, "-d", extracted], {
    cwd: root,
    quiet: true,
  });
  const payload = join(extracted, "Payload");
  const app = (await readdir(payload, { withFileTypes: true })).find(
    (file) => file.isDirectory() && file.name.endsWith(".app"),
  );
  assert(
    app,
    "IOS_SIGNATURE_INVALID",
    "The exported IPA does not contain an app bundle",
  );
  await runProcess(
    "codesign",
    ["--verify", "--deep", "--strict", join(payload, app.name)],
    { cwd: root, quiet: true },
  );
}
