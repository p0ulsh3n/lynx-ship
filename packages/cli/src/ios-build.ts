import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, sha256, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import type { BuildProfile } from "./config.js";
import { loadR2, uploadR2Artifact } from "./r2.js";
import { nativeArtifactName } from "./artifact-name.js";
import {
  commandExists,
  packageManagerScriptCommand,
  runProcess,
} from "./process-runner.js";

interface IosBuildOptions {
  root: string;
  profile: BuildProfile;
  quiet?: boolean;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
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
  if (configured) return resolve(root, configured);
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
  const projectFlag = project.endsWith(".xcworkspace")
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
    await loadR2(options.root);
    await mkdir(archiveDirectory, { recursive: true });
    transitionBuild(job, "uploading_source", "iOS source prepared");
    step("Building Lynx bundle with Rspeedy…", 5);
    const packageManager = packageManagerScriptCommand(options.root, "build");
    await runProcess(packageManager.command, packageManager.args, {
      cwd: options.root,
      quiet: options.quiet,
      onOutput: options.onEvent,
    });
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
    step("Preparing Xcode archive…", 10);
    await runProcess(
      "xcodebuild",
      [
        projectFlag,
        project,
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
    job.attempts += 1;
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
