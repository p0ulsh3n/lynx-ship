import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageManagerScriptCommand, runProcess } from "./process-runner.js";

interface PackageManifest {
  scripts?: Record<string, string>;
}

export interface BundleBuildOptions {
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
  onOutput?: (line: string) => void;
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
  const script = await resolveBundleScript(root);
  const packageManager = packageManagerScriptCommand(root, script);
  await runProcess(packageManager.command, packageManager.args, {
    cwd: root,
    env: options.env,
    quiet: options.quiet,
    onOutput: options.onOutput,
  });
}
