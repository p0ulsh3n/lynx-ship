import { access } from "node:fs/promises";
import { constants } from "node:fs";
import type { IosWorkerEnvironment } from "./contracts.js";

export type CommandProbe = (command: string) => Promise<boolean>;

async function defaultProbe(command: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? "";
  for (const entry of pathValue.split(":")) {
    try {
      await access(`${entry}/${command}`, constants.X_OK);
      return true;
    } catch {
      // Keep probing the complete PATH.
    }
  }
  return false;
}

export async function inspectIosWorkerEnvironment(
  probe: CommandProbe = defaultProbe,
): Promise<IosWorkerEnvironment> {
  const checks = [
    {
      name: "host" as const,
      available: process.platform === "darwin",
      detail: `${process.platform} host; iOS builds require macOS`,
    },
    {
      name: "xcodebuild" as const,
      available: await probe("xcodebuild"),
      detail: "Xcode command-line build tool",
    },
    {
      name: "xcrun" as const,
      available: await probe("xcrun"),
      detail: "Xcode SDK/tool discovery tool",
    },
  ];
  return {
    platform: process.platform,
    checks,
    ready: checks.every((check) => check.available),
  };
}
