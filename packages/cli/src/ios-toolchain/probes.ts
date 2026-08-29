import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  IosBuildTarget,
  IosToolchainCheck,
  IosToolchainStatus,
} from "./types.js";
import type { BuildProfile } from "../config.js";
import {
  captureProcess,
  commandExists,
  type CapturedProcessResult,
} from "../process-runner.js";

interface ProjectContext {
  path?: string;
  flag: "-workspace" | "-project";
  scheme?: string;
  settings?: CapturedProcessResult;
}

export function check(
  name: string,
  status: IosToolchainStatus,
  value: string,
  fix?: string,
): IosToolchainCheck {
  return { name, status, ok: status !== "fail", value, fix };
}

export function findHost(
  root: string,
  profile: BuildProfile,
): string | undefined {
  const configured = profile.ios?.workspace ?? profile.ios?.project;
  if (configured) {
    const configuredPath = resolve(root, configured);
    if (configuredPath.endsWith(".xcodeproj")) {
      const workspace = configuredPath.replace(/\.xcodeproj$/, ".xcworkspace");
      if (existsSync(workspace)) return workspace;
    }
    return configuredPath;
  }
  for (const directory of ["ios", "macos"]) {
    try {
      const candidate = readdirSync(join(root, directory)).find(
        (name) => name.endsWith(".xcworkspace") || name.endsWith(".xcodeproj"),
      );
      if (candidate) return join(root, directory, candidate);
    } catch {
      // A native host is optional until an iOS build is requested.
    }
  }
  return undefined;
}

export function projectFlag(path: string): "-workspace" | "-project" {
  return path.endsWith(".xcworkspace") ? "-workspace" : "-project";
}

export function commandOutput(result: CapturedProcessResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

export function setting(output: string, name: string): string | undefined {
  return output.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim();
}

export function provisioningProfilesDirectory(): string {
  return join(homedir(), "Library", "MobileDevice", "Provisioning Profiles");
}

export function provisioningProfileFiles(): string[] {
  try {
    return readdirSync(provisioningProfilesDirectory())
      .filter((name) => /\.(?:mobileprovision|provisionprofile)$/.test(name))
      .map((name) => join(provisioningProfilesDirectory(), name));
  } catch {
    return [];
  }
}

export function plistValue(content: string, key: string): string | undefined {
  return content.match(
    new RegExp(`<key>${key}</key>\\s*<(?:string|date)>([^<]+)</`),
  )?.[1];
}

export async function validProvisioningProfile(
  file: string,
  root: string,
  bundleIdentifier?: string,
): Promise<boolean> {
  if (!commandExists("security")) return false;
  try {
    const decoded = await captureProcess(
      "security",
      ["cms", "-D", "-i", file],
      { cwd: root },
    );
    if (decoded.code !== 0) return false;
    const content = commandOutput(decoded);
    const expiration = plistValue(content, "ExpirationDate");
    if (!expiration || Number.isNaN(Date.parse(expiration))) return false;
    if (Date.parse(expiration) <= Date.now()) return false;
    if (!bundleIdentifier) return true;
    const applicationIdentifier = plistValue(content, "application-identifier");
    if (!applicationIdentifier) return false;
    const profileBundle = applicationIdentifier.split(".").slice(1).join(".");
    return profileBundle === bundleIdentifier || profileBundle === "*";
  } catch {
    return false;
  }
}

export async function hasValidProvisioningProfile(
  root: string,
  bundleIdentifier: string | undefined,
): Promise<boolean> {
  const files = provisioningProfileFiles();
  for (const file of files) {
    if (await validProvisioningProfile(file, root, bundleIdentifier))
      return true;
  }
  return false;
}

export async function probeProject(
  root: string,
  context: ProjectContext,
  profile: BuildProfile,
  target: IosBuildTarget,
): Promise<ProjectContext> {
  if (!context.path || !context.scheme || !commandExists("xcodebuild"))
    return context;
  const configuration =
    profile.ios?.configuration ??
    (target === "simulator" ? "Debug" : "Release");
  const settings = await captureProcess(
    "xcodebuild",
    [
      context.flag,
      context.path,
      "-scheme",
      context.scheme,
      "-configuration",
      configuration,
      "-showBuildSettings",
    ],
    { cwd: root },
  );
  return { ...context, settings };
}

export async function probeVersion(
  command: string,
  args: string[],
  cwd: string,
): Promise<string | undefined> {
  if (!commandExists(command)) return undefined;
  try {
    const result = await captureProcess(command, args, { cwd });
    if (result.code !== 0) return undefined;
    return commandOutput(result).split(/\r?\n/)[0]?.trim();
  } catch {
    return undefined;
  }
}

export async function probeCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<boolean> {
  if (!commandExists(command)) return false;
  try {
    return (await captureProcess(command, args, { cwd })).code === 0;
  } catch {
    return false;
  }
}
