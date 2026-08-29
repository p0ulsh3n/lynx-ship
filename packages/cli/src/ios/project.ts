import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert } from "@lynxship/contracts";
import type { BuildProfile } from "../config.js";
import { commandExists, runProcess } from "../process-runner.js";

export function findProject(root: string, profile: BuildProfile): string {
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
        (name: string) =>
          name.endsWith(".xcworkspace") || name.endsWith(".xcodeproj"),
      );
      if (candidate) return join(root, directory, candidate);
    } catch {
      // The platform host is optional until an iOS/macOS build is requested.
    }
  }
  throw new Error("No Xcode workspace or project found under ios/ or macos/");
}

export async function installCocoaPods(
  root: string,
  quiet: boolean | undefined,
  onEvent: ((message: string) => void) | undefined,
): Promise<void> {
  const iosDirectory = join(root, "ios");
  const podfile = join(iosDirectory, "Podfile");
  if (!existsSync(podfile)) return;
  assert(
    commandExists("pod"),
    "IOS_COCOAPODS_REQUIRED",
    "CocoaPods was not found. Install CocoaPods on macOS, then rerun the build.",
  );
  const hasLockfile = existsSync(join(iosDirectory, "Podfile.lock"));
  onEvent?.(
    hasLockfile
      ? "Installing iOS CocoaPods dependencies…"
      : "Updating CocoaPods specs and installing iOS dependencies…",
  );
  await runProcess(
    "pod",
    hasLockfile ? ["install"] : ["install", "--repo-update"],
    {
      cwd: iosDirectory,
      quiet,
      onOutput: onEvent,
    },
  );
}
