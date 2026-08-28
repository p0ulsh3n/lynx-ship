import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { assert, LynxShipError } from "@lynxship/contracts";
import { acquireMicroHs } from "@lynxship/microhs";
import {
  commandExists,
  packageManagerScriptCommand,
  runProcess,
  runRspeedy,
} from "./process-runner.js";
import { detectLynxFramework } from "./frameworks.js";

interface PackageManifest {
  scripts?: Record<string, string>;
}

export interface BundleBuildOptions {
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
  onOutput?: (line: string) => void;
  script?: string;
  rspeedyArgs?: string[];
  miso?: {
    compiler?: "ghcjs" | "microhs";
    attribute?: string;
    artifact?: string;
    microhs?: {
      version?: string;
      binary?: string;
      manifest?: string;
      manifestUrl?: string;
      cacheDir?: string;
      publicKey?: string;
      adapter?: { command: string; args?: string[] };
    };
  };
}

export function resolveMisoBuildTarget(
  flake: string,
  configuredAttribute?: string,
): string | undefined {
  const explicitAttribute = configuredAttribute?.trim();
  if (explicitAttribute) return ".#" + explicitAttribute;
  if (flake.includes("counter-bundle")) return ".#counter-bundle";
  if (/\binherit\s+bundle\b|\bdefault\s*=\s*bundle\b/.test(flake)) {
    return ".#bundle";
  }
  if (/\bdefault\s*=/.test(flake) && flake.includes("mkLynxBundle")) {
    return ".";
  }
  return undefined;
}

async function resolveBundleScript(root: string): Promise<string> {
  try {
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as PackageManifest;
    if (manifest.scripts?.["build:mobile"]) return "build:mobile";
  } catch {
    // The package manager will report the useful project error below.
  }
  return "build";
}

async function copyMisoBundle(
  root: string,
  artifactPath: string,
  onOutput?: (line: string) => void,
): Promise<void> {
  const artifact = resolve(root, artifactPath);
  const relativeArtifact = relative(resolve(root), artifact);
  assert(
    relativeArtifact !== "" &&
      !relativeArtifact.startsWith("..") &&
      !isAbsolute(relativeArtifact),
    "BUILD_MISO_ARTIFACT_OUTSIDE_PROJECT",
    "The Miso bundle artifact must remain inside the project directory: " +
      artifactPath,
  );
  let artifactInfo: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    artifactInfo = await stat(artifact);
  } catch {
    assert(
      false,
      "BUILD_MISO_BUNDLE_MISSING",
      "The Miso adapter did not produce the configured Lynx bundle: " +
        artifact,
    );
  }
  assert(
    artifactInfo?.isFile() && artifactInfo.size > 0,
    "BUILD_MISO_BUNDLE_INVALID",
    "The Miso adapter produced an empty or non-file Lynx bundle: " + artifact,
  );
  const output = join(root, "dist", basename(artifact));
  await mkdir(join(root, "dist"), { recursive: true });
  await copyFile(artifact, output);
  onOutput?.("Miso bundle ready: " + output);
}

async function buildMisoWithMicroHs(
  root: string,
  options: BundleBuildOptions,
): Promise<void> {
  const microhs = options.miso?.microhs;
  assert(
    microhs?.adapter?.command,
    "BUILD_MISO_MICROHS_ADAPTER_REQUIRED",
    "MicroHs is not a drop-in GHCJS replacement. Configure build.<profile>.miso.microhs.adapter with the real Miso/MicroHs adapter command, or use compiler=ghcjs.",
  );
  const resolveProjectPath = (value: string | undefined): string | undefined =>
    value ? resolve(root, value) : undefined;
  const configuredBinary =
    microhs.binary ?? process.env.LYNXSHIP_MICROHS_BINARY;
  const configuredManifest =
    microhs.manifest ?? process.env.LYNXSHIP_MICROHS_MANIFEST;
  const configuredCache =
    microhs.cacheDir ?? process.env.LYNXSHIP_MICROHS_CACHE;
  const toolchain = await acquireMicroHs({
    version: microhs.version ?? process.env.LYNXSHIP_MICROHS_VERSION,
    binaryPath: resolveProjectPath(configuredBinary),
    manifestPath: resolveProjectPath(configuredManifest),
    manifestUrl:
      microhs.manifestUrl ?? process.env.LYNXSHIP_MICROHS_MANIFEST_URL,
    cacheDir: resolveProjectPath(configuredCache),
    publicKey: microhs.publicKey ?? process.env.LYNXSHIP_MICROHS_PUBLIC_KEY,
  });
  const artifact = options.miso?.artifact ?? "result/main.lynx.bundle";
  try {
    await runProcess(microhs.adapter.command, microhs.adapter.args ?? [], {
      cwd: root,
      env: {
        ...options.env,
        LYNXSHIP_MICROHS_BINARY: toolchain.binaryPath,
        LYNXSHIP_MICROHS_VERSION: toolchain.version,
        LYNXSHIP_MISO_COMPILER: "microhs",
        LYNXSHIP_MISO_OUTPUT: resolve(root, artifact),
      } as NodeJS.ProcessEnv,
      quiet: options.quiet,
      onOutput: options.onOutput,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LynxShipError(
      "BUILD_MISO_MICROHS_ADAPTER_FAILED",
      `The configured Miso/MicroHs adapter failed: ${detail}`,
      { cause: detail },
    );
  }
  await copyMisoBundle(root, artifact, options.onOutput);
}

export async function buildLynxBundle(
  root: string,
  options: BundleBuildOptions = {},
): Promise<void> {
  const framework = await detectLynxFramework(root);
  if (
    framework.framework === "miso" &&
    options.miso?.compiler === "microhs" &&
    !options.script &&
    !options.rspeedyArgs
  ) {
    await buildMisoWithMicroHs(root, options);
    return;
  }
  if (
    framework.buildSystem === "miso-nix" &&
    !options.script &&
    !options.rspeedyArgs
  ) {
    assert(
      commandExists("nix"),
      "BUILD_MISO_NIX_REQUIRED",
      "Miso requires Nix. Install Nix, then rerun lynxship doctor or provide a project build script.",
    );
    const flake = await readFile(join(root, "flake.nix"), "utf8").catch(
      () => "",
    );
    const target = resolveMisoBuildTarget(flake, options.miso?.attribute);
    assert(
      target,
      "BUILD_MISO_ATTRIBUTE_REQUIRED",
      "Miso bundle output is not discoverable. Set build.<profile>.miso.attribute in lynxship.json, or expose a default/mkLynxBundle output in flake.nix.",
    );
    await runProcess("nix", ["build", target], {
      cwd: root,
      env: options.env,
      quiet: options.quiet,
      onOutput: options.onOutput,
    });
    await copyMisoBundle(
      root,
      options.miso?.artifact ?? "result/main.lynx.bundle",
      options.onOutput,
    );
    return;
  }
  if (!options.script && options.rspeedyArgs) {
    await runRspeedy(root, "build", options.rspeedyArgs, {
      env: options.env,
      quiet: options.quiet,
      onOutput: options.onOutput,
    });
    return;
  }
  const script = options.script ?? (await resolveBundleScript(root));
  const packageManager = packageManagerScriptCommand(
    root,
    script,
    options.rspeedyArgs ?? [],
  );
  await runProcess(packageManager.command, packageManager.args, {
    cwd: root,
    env: options.env,
    quiet: options.quiet,
    onOutput: options.onOutput,
  });
}
