#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const CREATE_APP_VERSION = "0.1.3";

export const RSPEEDY_VERSION = "latest";

export const LYNXSHIP_CLI_VERSION = "latest";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type CreateAppTemplate = "react-ts" | "react-js" | "vue-ts" | "vue-js";

export interface CreateAppOptions {
  readonly projectName?: string;
  readonly directory?: string;
  readonly template: CreateAppTemplate;
  readonly install: boolean;
  readonly git: boolean;
}

export interface CreateAppResult {
  readonly directory: string;
  readonly projectId: string;
  readonly packageManager: PackageManager;
  readonly installed: boolean;
}

const HELP = `Usage: create-lynxship-app [project-name] [options]

Create a new LynxJS application using an official Lynx scaffold.

Options:
  -d, --dir <directory>       Create the project in a specific directory
  -t, --template <template>   react-ts (default), react-js, vue-ts or vue-js
      --no-install             Skip dependency installation
      --no-git                  Skip Git repository initialization
  -h, --help                  Show this help
  -v, --version               Show the version

Examples:
  npx create-lynxship-app@latest my-app
  npm create lynxship-app@latest my-app
  pnpm create lynxship-app@latest my-app --template react-ts
  pnpm create lynxship-app@latest my-app --template vue-ts
`;

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseArguments(args: string[]): CreateAppOptions & {
  readonly help: boolean;
  readonly version: boolean;
} {
  let projectName: string | undefined;
  let directory: string | undefined;
  let template: CreateAppOptions["template"] = "react-ts";
  let install = true;
  let git = true;
  let help = false;
  let version = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === "--") {
      const value = args[index + 1];
      if (value) {
        if (projectName) throw new Error("Only one project name is allowed.");
        projectName = value;
        index += 1;
      }
      continue;
    }
    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "-v" || argument === "--version") {
      version = true;
      continue;
    }
    if (argument === "--no-install") {
      install = false;
      continue;
    }
    if (argument === "--no-git") {
      git = false;
      continue;
    }
    if (
      argument === "-d" ||
      argument === "--dir" ||
      argument === "--directory"
    ) {
      directory = valueAfter(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "-t" || argument === "--template") {
      const value = valueAfter(args, index, argument);
      if (
        value !== "react-ts" &&
        value !== "react-js" &&
        value !== "vue-ts" &&
        value !== "vue-js"
      ) {
        throw new Error(
          `Unsupported template '${value}'. Use react-ts, react-js, vue-ts or vue-js.`,
        );
      }
      template = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown option '${argument}'. Run with --help.`);
    }
    if (projectName) throw new Error("Only one project name is allowed.");
    projectName = argument;
  }

  if (projectName && directory) {
    throw new Error("Use either a project name or --dir, not both.");
  }

  return { projectName, directory, template, install, git, help, version };
}

export function detectPackageManager(
  environment: NodeJS.ProcessEnv = process.env,
): PackageManager {
  const userAgent = environment.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  if (userAgent.startsWith("bun")) return "bun";
  return "npm";
}

export function createLynxShipConfig(projectId = randomUUID()): string {
  return `${JSON.stringify(
    {
      runtimeVersion: { policy: "fingerprint" },
      build: {
        development: {
          distribution: "development",
          channel: "development",
          environment: "development",
          ios: { configuration: "Debug" },
        },
        simulator: {
          distribution: "development",
          channel: "development",
          environment: "development",
          ios: { configuration: "Debug", simulator: true },
        },
        production: {
          distribution: "store",
          channel: "production",
          environment: "production",
        },
      },
      update: { protocolVersion: 1, channel: "production" },
      projectId,
    },
    null,
    2,
  )}\n`;
}

export async function addLynxShipCliDependency(
  directory: string,
): Promise<void> {
  const packageJsonPath = join(directory, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  packageJson.devDependencies = {
    ...packageJson.devDependencies,
    "@lynxship/cli": LYNXSHIP_CLI_VERSION,
  };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function askForProjectName(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "A project name is required in non-interactive mode. Example: npx create-lynxship-app my-app",
    );
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question("Project name [my-lynx-app]: ");
    return answer.trim() || "my-lynx-app";
  } finally {
    readline.close();
  }
}

function normalizeProjectName(value: string): string {
  const name = value.trim();
  if (!name || name === "." || name === "..") {
    throw new Error("The project name cannot be empty.");
  }
  if (name.includes("\0")) throw new Error("The project name is invalid.");
  const leaf = basename(name);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(leaf)) {
    throw new Error(
      "The project name must contain only letters, numbers, dots, hyphens, and underscores.",
    );
  }
  return name;
}

async function ensureTargetIsSafe(directory: string): Promise<void> {
  if (!existsSync(directory)) return;
  const entries = await readdir(directory);
  if (entries.length > 0) {
    throw new Error(
      `Target directory is not empty: ${directory}. Choose another name or move the existing files first.`,
    );
  }
}

function executable(command: PackageManager | "npx"): string {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

export function scaffoldPackage(
  template: CreateAppTemplate,
): "create-rspeedy" | "create-vue-lynx" {
  return template.startsWith("vue-") ? "create-vue-lynx" : "create-rspeedy";
}

export function createScaffoldCommand(
  manager: PackageManager,
  directory: string,
  template: CreateAppTemplate,
  git: boolean,
): { command: string; args: string[] } {
  const packageName = scaffoldPackage(template);
  const args = [
    `${packageName}@${RSPEEDY_VERSION}`,
    "--dir",
    directory,
    "--template",
    template,
  ];
  if (!git) args.push("--no-git");

  if (manager === "npm") {
    return { command: executable("npx"), args: ["--yes", ...args] };
  }
  if (manager === "pnpm") {
    return { command: executable("pnpm"), args: ["dlx", ...args] };
  }
  if (manager === "yarn") {
    return { command: executable("yarn"), args: ["dlx", ...args] };
  }
  return { command: executable("bun"), args: ["x", "--bun", ...args] };
}

function installCommand(manager: PackageManager): {
  command: string;
  args: string[];
} {
  return { command: executable(manager), args: ["install"] };
}

async function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const executable =
      process.platform === "win32" && command.toLowerCase().endsWith(".cmd")
        ? (process.env.ComSpec ?? "cmd.exe")
        : command;
    const executableArgs =
      executable === command ? args : ["/d", "/s", "/c", command, ...args];

    let child;
    try {
      child = spawn(executable, executableArgs, {
        cwd,
        env: process.env,
        stdio: "inherit",
        windowsHide: false,
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command}`);
  }
}

async function writeProjectMetadata(
  directory: string,
  template: CreateAppTemplate,
): Promise<string> {
  const projectId = randomUUID();
  await mkdir(join(directory, ".lynxship"), { recursive: true });
  await writeFile(
    join(directory, "lynxship.json"),
    createLynxShipConfig(projectId),
  );

  const gitignorePath = join(directory, ".gitignore");
  const currentGitignore = existsSync(gitignorePath)
    ? await readFile(gitignorePath, "utf8")
    : "";
  if (!/(^|\r?\n)\.lynxship\/(?:\r?\n|$)/u.test(currentGitignore)) {
    const prefix =
      currentGitignore.length > 0 && !currentGitignore.endsWith("\n")
        ? "\n"
        : "";
    await writeFile(gitignorePath, `${currentGitignore}${prefix}.lynxship/\n`);
  }

  await writeFile(
    join(directory, "LYNXSHIP.md"),
    `# LynxShip

This project was created from the official ${scaffoldPackage(template)} template.

The LynxShip CLI is installed locally in this project.

## Development

~~~bash
npx lynxship doctor
npx lynxship dev
~~~

Scan the development QR code with Lynx Explorer for live iteration.

## Native builds

~~~bash
npx lynxship build --platform android --profile production
npx lynxship build --platform ios --profile production
~~~

Android and iOS builds require their official native host and platform toolchain.
LynxShip creates a missing host during an interactive build, but it never overwrites an existing native project.
`,
  );
  return projectId;
}

async function resolveTarget(options: CreateAppOptions): Promise<string> {
  const input =
    options.directory ?? options.projectName ?? (await askForProjectName());
  const normalized = normalizeProjectName(input);
  return isAbsolute(normalized)
    ? resolve(normalized)
    : resolve(process.cwd(), normalized);
}

export async function createApp(
  options: CreateAppOptions,
): Promise<CreateAppResult> {
  const targetDirectory = await resolveTarget(options);
  await ensureTargetIsSafe(targetDirectory);
  await mkdir(dirname(targetDirectory), { recursive: true });

  const packageManager = detectPackageManager();
  const scaffold = scaffoldPackage(options.template);
  console.log("\n◆ Create LynxShip App\n");
  console.log(`  Project       ${basename(targetDirectory)}`);
  console.log(`  Template      ${options.template}`);
  console.log(`  Package tool  ${packageManager}`);
  console.log(`  Source        ${scaffold}@${RSPEEDY_VERSION}\n`);
  console.log("◆ Creating the official Lynx/Rspeedy project…\n");

  const createCommand = createScaffoldCommand(
    packageManager,
    targetDirectory,
    options.template,
    options.git,
  );
  await run(createCommand.command, createCommand.args, process.cwd());

  console.log("\n◆ Adding LynxShip CLI dependency…");
  await addLynxShipCliDependency(targetDirectory);

  console.log("\n◆ Adding LynxShip project metadata…");
  const projectId = await writeProjectMetadata(
    targetDirectory,
    options.template,
  );
  if (options.install) {
    console.log(`◆ Installing dependencies with ${packageManager}…\n`);
    const install = installCommand(packageManager);
    await run(install.command, install.args, targetDirectory);
  }

  console.log("\n◆ Project created successfully\n");
  console.log(`  Project ID  ${projectId}`);
  console.log("\nNext steps:\n");
  console.log(`  cd ${targetDirectory}`);
  if (!options.install) console.log(`  ${packageManager} install`);
  console.log("  npx lynxship doctor");
  console.log("  npx lynxship dev");
  console.log("  npx lynxship build --platform android --profile production\n");

  return {
    directory: targetDirectory,
    projectId,
    packageManager,
    installed: options.install,
  };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.version) {
    console.log(CREATE_APP_VERSION);
    return;
  }
  await createApp(options);
}

function isCliEntrypoint(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) return false;

  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(invokedPath) === realpathSync(modulePath);
  } catch {
    return resolve(invokedPath) === resolve(modulePath);
  }
}

if (isCliEntrypoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nx ${message}`);
    process.exitCode = 1;
  });
}
