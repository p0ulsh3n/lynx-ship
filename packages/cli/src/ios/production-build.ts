import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, sha256, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import type { BuildProfile } from "../config.js";
import { loadR2, uploadR2Artifact } from "../r2.js";
import { nativeArtifactName } from "../artifact-name.js";
import { commandExists, runProcess } from "../process-runner.js";
import { buildLynxBundle } from "../bundle-build.js";

import type { IosBuildOptions } from "./types.js";
import { findArchiveApp } from "./simulator.js";
import { prepareIosAppIcon, syncIosRuntimeResources } from "./assets.js";
import { runRealIosSimulatorBuild } from "./simulator-build.js";
import { findProject, installCocoaPods } from "./project.js";

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
