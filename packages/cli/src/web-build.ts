import { readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import type { BuildProfile } from "./config.js";
import { publishBuiltArtifact } from "./artifact-build.js";
import { buildLynxBundle } from "./bundle-build.js";

interface WebBuildOptions {
  root: string;
  profile: BuildProfile;
  uploadArtifacts?: boolean;
  skipBundleBuild?: boolean;
  quiet?: boolean;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
}

interface PackageManifest {
  scripts?: Record<string, string>;
}

function readPackageManifest(root: string): PackageManifest {
  try {
    return JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as PackageManifest;
  } catch {
    return {};
  }
}

export function detectWebBuildScript(root: string): string | undefined {
  const scripts = readPackageManifest(root).scripts;
  if (!scripts) return undefined;
  for (const name of ["build:web", "build:web:production"]) {
    if (scripts[name]) return name;
  }
  return undefined;
}

async function webBundle(root: string, profile: BuildProfile): Promise<string> {
  const configured = profile.web?.artifact;
  if (configured) {
    const file = resolve(root, configured);
    assert(
      existsSync(file),
      "WEB_BUNDLE_MISSING",
      `Configured Web bundle was not found: ${file}`,
    );
    return file;
  }
  const candidates: string[] = [];
  for (const directory of ["dist", "build/web", "build"]) {
    const entries = await readdir(join(root, directory), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".web.bundle"))
        candidates.push(join(root, directory, entry.name));
    }
  }
  assert(
    candidates.length === 1,
    "WEB_BUNDLE_MISSING",
    candidates.length === 0
      ? "Rspeedy did not produce a *.web.bundle in dist/, build/web/ or build/. Configure environments.web in lynx.config.* or set build.<profile>.web.artifact."
      : "Rspeedy produced multiple *.web.bundle files. Set build.<profile>.web.artifact explicitly.",
  );
  return candidates[0]!;
}

export function hasWebConfiguration(root: string): boolean {
  const config = [
    "lynx.config.ts",
    "lynx.config.js",
    "lynx.config.mjs",
    "lynx.config.cjs",
  ]
    .map((file) => join(root, file))
    .find((file) => existsSync(file));
  if (config) {
    const source = readFileSync(config, "utf8");
    if (/environments[\s\S]{0,500}\bweb\b/i.test(source)) return true;
  }
  return Boolean(detectWebBuildScript(root));
}

export async function runRealWebBuild(
  job: BuildJob,
  options: WebBuildOptions,
): Promise<BuildJob> {
  const uploadArtifacts = options.uploadArtifacts ?? true;
  const step = (message: string, value?: number): void => {
    options.onEvent?.(message);
    options.onProgress?.(value, message);
  };
  try {
    transitionBuild(job, "uploading_source", "Web source prepared");
    if (!options.skipBundleBuild) {
      step("Building Lynx Web bundle with Rspeedy…", 10);
      const script =
        options.profile.web?.script ?? detectWebBuildScript(options.root);
      await buildLynxBundle(options.root, {
        quiet: options.quiet,
        onOutput: options.onEvent,
        script,
        miso: options.profile.miso,
        rspeedyArgs: script
          ? undefined
          : ["--environment", options.profile.web?.environment ?? "web"],
      });
    } else step("Using existing Lynx Web bundle", 20);
    const artifact = await webBundle(options.root, options.profile);
    transitionBuild(job, "queued", "Web bundle queued locally");
    transitionBuild(job, "provisioning", "Lynx Web environment selected");
    transitionBuild(job, "installing_dependencies", "Web bundle verified");
    transitionBuild(job, "building", "Web bundle created");
    step("Lynx Web bundle ready", 70);
    return await publishBuiltArtifact({
      root: options.root,
      job,
      platform: "web",
      artifactPath: artifact,
      extension: "web.bundle",
      contentType: "application/octet-stream",
      uploadArtifacts,
      verificationMessage: "Web bundle output verified",
      quiet: options.quiet,
      onEvent: options.onEvent,
      onProgress: options.onProgress,
    });
  } catch (error) {
    if (!["success", "failed", "canceled", "timed_out"].includes(job.state))
      transitionBuild(
        job,
        "failed",
        error instanceof Error ? error.message : "Web build failed",
      );
    job.logs.push({
      level: "error",
      message: error instanceof Error ? error.message : "Web build failed",
      at: new Date().toISOString(),
    });
    throw error;
  }
}
