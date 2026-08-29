import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  LYNXSHIP_CLI_VERSION,
  RSPEEDY_VERSION,
  type CreateAppTemplate,
  type PackageManager,
} from "./model.js";

export function detectPackageManager(
  environment: { npm_config_user_agent?: string } = process.env as {
    npm_config_user_agent?: string;
  },
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

export function installCommand(manager: PackageManager): {
  command: string;
  args: string[];
} {
  return { command: executable(manager), args: ["install"] };
}

export async function run(
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

export async function writeProjectMetadata(
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
