import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { assert } from "@lynxship/contracts";
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
    attribute?: string;
    artifact?: string;
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

export async function buildLynxBundle(
  root: string,
  options: BundleBuildOptions = {},
): Promise<void> {
  const framework = await detectLynxFramework(root);
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
    const artifact = resolve(
      root,
      options.miso?.artifact ?? "result/main.lynx.bundle",
    );
    assert(
      existsSync(artifact),
      "BUILD_MISO_BUNDLE_MISSING",
      "Miso did not produce the configured Lynx bundle: " + artifact,
    );
    const output = join(root, "dist", basename(artifact));
    await mkdir(join(root, "dist"), { recursive: true });
    await copyFile(artifact, output);
    options.onOutput?.("Miso bundle ready: " + output);
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
