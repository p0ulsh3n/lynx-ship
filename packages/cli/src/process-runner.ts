import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
  onOutput?: (line: string) => void;
}

export function packageManagerCommand(root: string): {
  command: string;
  prefix: string[];
} {
  const configured =
    process.env.LYNXSHIP_PACKAGE_MANAGER ?? process.env.LYNXSHIP_PNPM_PATH;
  const packageManager = configured ?? detectPackageManager(root);
  const command =
    process.platform === "win32" && !/\.(?:cmd|bat|exe)$/i.test(packageManager)
      ? `${packageManager}.cmd`
      : packageManager;
  const normalized = packageManager.split(/[\\/]/).at(-1)?.toLowerCase();
  return normalized === "yarn" || normalized === "yarn.cmd"
    ? { command, prefix: [] }
    : normalized === "npm" || normalized === "npm.cmd"
      ? { command, prefix: ["exec", "--"] }
      : { command, prefix: ["exec"] };
}

export function packageManagerScriptCommand(
  root: string,
  script: string,
  args: string[] = [],
): { command: string; args: string[] } {
  const manager = packageManagerCommand(root);
  return { command: manager.command, args: ["run", script, ...args] };
}

function detectPackageManager(root: string): "pnpm" | "npm" | "yarn" {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { packageManager?: string };
    if (packageJson.packageManager?.startsWith("npm@")) return "npm";
    if (packageJson.packageManager?.startsWith("yarn@")) return "yarn";
    if (packageJson.packageManager?.startsWith("pnpm@")) return "pnpm";
  } catch {
    // Lockfiles below are the next reliable signal.
  }
  try {
    if (existsSync(join(root, "package-lock.json"))) return "npm";
    if (existsSync(join(root, "yarn.lock"))) return "yarn";
  } catch {
    // Default to pnpm for this workspace.
  }
  return "pnpm";
}

export function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<void> {
  const windowsCommand =
    process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command);
  const commandLine = [command, ...args]
    .map((value) =>
      /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value,
    )
    .join(" ");
  return new Promise((resolve, reject) => {
    const child = spawn(
      windowsCommand ? "cmd.exe" : command,
      windowsCommand ? ["/d", "/s", "/c", commandLine] : args,
      {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let pending = "";
    let output = "";
    const forward = (chunk: Buffer): void => {
      output += chunk.toString();
      pending += chunk.toString().replace(/\r(?!\n)/g, "\n");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const clean = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim();
        if (clean && !options.quiet) options.onOutput?.(clean);
      }
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (pending.trim() && !options.quiet) options.onOutput?.(pending.trim());
      if (code === 0) return resolve();
      const lastLine = output.trim().split(/\r?\n/).at(-1) ?? "";
      reject(
        new Error(
          `${command} ${args.join(" ")} failed (${signal ?? `exit ${code}`})${lastLine ? `: ${lastLine}` : ""}`,
        ),
      );
    });
  });
}

export async function runRspeedy(
  root: string,
  subcommand: string,
  args: string[],
  options: Omit<ProcessOptions, "cwd">,
): Promise<void> {
  const manager = packageManagerCommand(root);
  await runProcess(
    manager.command,
    [...manager.prefix, "rspeedy", subcommand, ...args],
    { ...options, cwd: root },
  );
}

export function commandExists(command: string): boolean {
  const pathValue = process.env.PATH ?? "";
  const pathEntries = pathValue.split(process.platform === "win32" ? ";" : ":");
  const hasPathSeparator = /[\\/]/.test(command);
  const candidates = hasPathSeparator
    ? [command]
    : pathEntries.flatMap((directory) => {
        if (!directory) return [];
        if (process.platform !== "win32") return [join(directory, command)];
        const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean);
        return [
          join(directory, command),
          ...extensions.map((extension) =>
            join(directory, `${command}${extension}`),
          ),
        ];
      });
  const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK;
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, mode);
      return true;
    } catch {
      return false;
    }
  });
}

export function executableExists(file: string): boolean {
  try {
    accessSync(
      file,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}
