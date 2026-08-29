#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { CREATE_APP_HELP, parseArguments } from "./args.js";
import {
  addLynxShipCliDependency,
  createScaffoldCommand,
  detectPackageManager,
  installCommand,
  run,
  scaffoldPackage,
  writeProjectMetadata,
} from "./scaffold.js";
import {
  CREATE_APP_VERSION,
  RSPEEDY_VERSION,
  type CreateAppOptions,
  type CreateAppResult,
  type PackageManager,
} from "./model.js";

export {
  CREATE_APP_VERSION,
  RSPEEDY_VERSION,
  LYNXSHIP_CLI_VERSION,
  type CreateAppOptions,
  type CreateAppResult,
  type CreateAppTemplate,
  type PackageManager,
} from "./model.js";

export { parseArguments } from "./args.js";

export {
  addLynxShipCliDependency,
  createLynxShipConfig,
  createScaffoldCommand,
  detectPackageManager,
  scaffoldPackage,
} from "./scaffold.js";

async function askForProjectName(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "A project name is required in non-interactive mode. Example: npx create-lynxship-app my-app",
    );
  }
  const { createInterface } = await import("node:readline/promises");
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

  const packageManager: PackageManager = detectPackageManager();
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
    console.log(CREATE_APP_HELP);
    return;
  }
  if (options.version) {
    console.log(CREATE_APP_VERSION);
    return;
  }
  await createApp(options);
}
