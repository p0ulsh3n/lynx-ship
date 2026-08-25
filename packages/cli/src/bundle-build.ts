import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  packageManagerScriptCommand,
  runProcess,
  runRspeedy,
} from "./process-runner.js";

interface PackageManifest {
  scripts?: Record<string, string>;
}

export interface BundleBuildOptions {
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
  onOutput?: (line: string) => void;
  script?: string;
  rspeedyArgs?: string[];
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
