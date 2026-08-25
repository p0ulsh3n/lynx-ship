import { copyFile, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assert, type BuildJob } from "@lynxship/contracts";
import { transitionBuild } from "@lynxship/build-orchestrator";
import type { BuildProfile } from "./config.js";
import { publishBuiltArtifact } from "./artifact-build.js";
import { buildLynxBundle } from "./bundle-build.js";
import { commandExists, runProcess } from "./process-runner.js";

interface HarmonyBuildOptions {
  root: string;
  profile: BuildProfile;
  uploadArtifacts?: boolean;
  skipBundleBuild?: boolean;
  quiet?: boolean;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
}

function harmonyRoot(root: string): string {
  return join(root, "harmony");
}

function wrapper(root: string): string | undefined {
  const directory = harmonyRoot(root);
  const candidates =
    process.platform === "win32"
      ? [join(directory, "hvigorw.bat"), join(directory, "hvigorw")]
      : [join(directory, "hvigorw"), join(directory, "hvigorw.sh")];
  return candidates.find((candidate) => existsSync(candidate));
}

export function hasHarmonyHost(root: string): boolean {
  return Boolean(
    wrapper(root) &&
    existsSync(join(harmonyRoot(root), "hvigorfile.ts")) &&
    existsSync(join(harmonyRoot(root), "build-profile.json5")) &&
    existsSync(join(harmonyRoot(root), "oh-package.json5")),
  );
}

export function harmonyToolchain(root: string): {
  ok: boolean;
  wrapper?: string;
  ohpm: boolean;
  hdc: boolean;
  message: string;
} {
  const projectWrapper = wrapper(root);
  const ohpm = commandExists("ohpm");
  const hdc = commandExists("hdc");
  return {
    ok: Boolean(projectWrapper && ohpm),
    wrapper: projectWrapper,
    ohpm,
    hdc,
    message:
      projectWrapper && ohpm
        ? "Hvigor and ohpm detected"
        : "Harmony host requires the project hvigorw wrapper and ohpm from DevEco Studio",
  };
}

export async function syncHarmonyAssets(
  root: string,
  profile: BuildProfile,
): Promise<string[]> {
  const dist = join(root, "dist");
  const entries = await readdir(dist, { withFileTypes: true }).catch(() => []);
  const bundles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".lynx.bundle"))
    .map((entry) => entry.name);
  assert(
    bundles.length > 0,
    "LYNX_BUNDLE_MISSING",
    `No .lynx.bundle was found in ${dist}. Check the Rspeedy output configuration.`,
  );
  const target = resolve(
    root,
    profile.harmony?.bundleDir ?? "harmony/entry/src/main/resources/rawfile",
  );
  await mkdir(target, { recursive: true });
  const outputNames = [...bundles, "async", "static"];
  const copied: string[] = [];
  for (const name of outputNames) {
    const source = join(dist, name);
    if (!existsSync(source)) continue;
    await rm(join(target, name), { recursive: true, force: true });
    if (name.endsWith(".lynx.bundle"))
      await copyFile(source, join(target, name));
    else await cp(source, join(target, name), { recursive: true, force: true });
    copied.push(name);
  }
  return copied;
}

async function findHap(root: string, configured?: string): Promise<string> {
  if (configured) {
    const file = resolve(root, configured);
    assert(
      existsSync(file),
      "HARMONY_ARTIFACT_MISSING",
      `Configured HAP was not found: ${file}`,
    );
    return file;
  }
  const result: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (entry.name === ".hvigor" || entry.name === "node_modules") continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith(".hap")) result.push(file);
    }
  }

  await visit(harmonyRoot(root));
  const signed = result.filter(
    (file) => !file.toLowerCase().includes("unsigned"),
  );
  assert(
    signed.length === 1,
    "HARMONY_ARTIFACT_AMBIGUOUS",
    signed.length === 0
      ? "Hvigor produced no signed HAP. Configure Harmony signing in build-profile.json5 or set build.<profile>.harmony.artifact."
      : "Hvigor produced multiple signed HAP files. Set build.<profile>.harmony.artifact explicitly.",
  );
  return signed[0]!;
}

function signToolPath(root: string, configured?: string): string | undefined {
  const candidates = [
    configured ? resolve(root, configured) : undefined,
    process.env.LYNXSHIP_HAP_SIGN_TOOL,
    process.env.DEVECO_HAP_SIGN_TOOL,
    process.env.HOS_SDK_HOME
      ? join(process.env.HOS_SDK_HOME, "toolchains", "lib", "hap-sign-tool.jar")
      : undefined,
    process.env.DEVECO_SDK_HOME
      ? join(
          process.env.DEVECO_SDK_HOME,
          "toolchains",
          "lib",
          "hap-sign-tool.jar",
        )
      : undefined,
    join(
      homedir(),
      ".ohos",
      "sdk",
      "default",
      "openharmony",
      "toolchains",
      "hap-sign-tool.jar",
    ),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((value) => existsSync(value));
}

async function verifySignedHap(
  root: string,
  artifact: string,
  configured?: string,
): Promise<void> {
  const tool = signToolPath(root, configured);
  assert(
    tool,
    "HARMONY_SIGN_TOOL_REQUIRED",
    "The official hap-sign-tool.jar is required to verify a signed HAP. Set LYNXSHIP_HAP_SIGN_TOOL or build.<profile>.harmony.signTool.",
  );
  assert(
    commandExists("java"),
    "HARMONY_JAVA_REQUIRED",
    "Java is required to run hap-sign-tool.jar.",
  );
  const directory = await mkdtemp(join(tmpdir(), "lynxship-hap-verify-"));
  try {
    await runProcess(
      "java",
      [
        "-jar",
        tool,
        "verify-app",
        "-inFile",
        artifact,
        "-outCertchain",
        join(directory, "certchain.pem"),
        "-outProfile",
        join(directory, "profile.p7b"),
      ],
      { cwd: root, quiet: true },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runRealHarmonyBuild(
  job: BuildJob,
  options: HarmonyBuildOptions,
): Promise<BuildJob> {
  const toolchain = harmonyToolchain(options.root);
  assert(
    hasHarmonyHost(options.root),
    "HARMONY_HOST_REQUIRED",
    "No complete HarmonyOS host was found. Add harmony/hvigorw, hvigorfile.ts, build-profile.json5 and oh-package.json5 from an official Lynx Harmony host.",
  );
  assert(toolchain.ok, "HARMONY_TOOLCHAIN_REQUIRED", toolchain.message);
  const projectWrapper = toolchain.wrapper!;
  const uploadArtifacts = options.uploadArtifacts ?? true;
  const step = (message: string, value?: number): void => {
    options.onEvent?.(message);
    options.onProgress?.(value, message);
  };
  try {
    transitionBuild(job, "uploading_source", "HarmonyOS source prepared");
    if (!options.skipBundleBuild) {
      step("Building Lynx bundle with Rspeedy…", 10);
      await buildLynxBundle(options.root, {
        quiet: options.quiet,
        onOutput: options.onEvent,
      });
    }
    step("Syncing bundle into the HarmonyOS HAP resources…", 20);
    const copiedAssets = await syncHarmonyAssets(options.root, options.profile);
    for (const name of copiedAssets)
      options.onEvent?.(`Synced dist/${name} into HarmonyOS rawfile resources`);
    transitionBuild(job, "queued", "HarmonyOS build queued locally");
    transitionBuild(job, "provisioning", "HarmonyOS Hvigor toolchain selected");
    transitionBuild(
      job,
      "installing_dependencies",
      "HarmonyOS dependencies selected",
    );
    step("Installing HarmonyOS dependencies with ohpm…", 30);
    await runProcess("ohpm", ["install"], {
      cwd: harmonyRoot(options.root),
      quiet: options.quiet,
      onOutput: options.onEvent,
    });
    transitionBuild(job, "building", "Hvigor HAP task started");
    const task = options.profile.harmony?.task ?? "assembleHap";
    step(`Running real Hvigor task ${task}…`, 45);
    const harmony = options.profile.harmony;
    const mode = harmony?.mode ?? "module";
    const args = [
      "--no-daemon",
      "--mode",
      mode,
      "-p",
      `product=${harmony?.product ?? "default"}`,
    ];
    if (mode === "module")
      args.push("-p", `module=${harmony?.module ?? "entry@default"}`);
    args.push("-p", `buildMode=${harmony?.buildMode ?? "release"}`);
    args.push(task);
    await runProcess(projectWrapper, args, {
      cwd: harmonyRoot(options.root),
      quiet: options.quiet,
      onOutput: options.onEvent,
    });
    const artifact = await findHap(
      options.root,
      options.profile.harmony?.artifact,
    );
    step("Verifying signed HarmonyOS HAP…", 75);
    await verifySignedHap(
      options.root,
      artifact,
      options.profile.harmony?.signTool,
    );
    return publishBuiltArtifact({
      root: options.root,
      job,
      platform: "harmony",
      artifactPath: artifact,
      extension: "hap",
      contentType: "application/octet-stream",
      uploadArtifacts,
      verificationMessage:
        "Signed HAP verified with the official hap-sign-tool",
      quiet: options.quiet,
      onEvent: options.onEvent,
      onProgress: options.onProgress,
    });
  } catch (error) {
    if (!["success", "failed", "canceled", "timed_out"].includes(job.state))
      transitionBuild(
        job,
        "failed",
        error instanceof Error ? error.message : "HarmonyOS build failed",
      );
    job.logs.push({
      level: "error",
      message:
        error instanceof Error ? error.message : "HarmonyOS build failed",
      at: new Date().toISOString(),
    });
    throw error;
  }
}
