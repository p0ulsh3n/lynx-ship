import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { AndroidWorkerEnvironment } from "./contracts.js";

export type CommandProbe = (command: string) => Promise<boolean>;

async function defaultProbe(command: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? "";
  const entries = pathValue.split(process.platform === "win32" ? ";" : ":");
  const candidates =
    process.platform === "win32"
      ? [`${command}.exe`, `${command}.bat`, command]
      : [command];
  for (const entry of entries) {
    for (const candidate of candidates) {
      try {
        await access(join(entry, candidate), constants.F_OK);
        return true;
      } catch {
        // Keep probing the complete PATH.
      }
    }
  }
  return false;
}

export async function inspectAndroidWorkerEnvironment(
  workspaceRoot: string,
  probe: CommandProbe = defaultProbe,
): Promise<AndroidWorkerEnvironment> {
  const wrapper = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  const wrapperPath = join(workspaceRoot, wrapper);
  let wrapperAvailable = false;
  try {
    await access(wrapperPath, constants.F_OK);
    wrapperAvailable = true;
  } catch {
    wrapperAvailable = false;
  }
  const checks = [
    {
      name: "host" as const,
      available: ["linux", "darwin", "win32"].includes(process.platform),
      detail: `${process.platform} host`,
    },
    {
      name: "java" as const,
      available: await probe("java"),
      detail: "Java executable on PATH",
    },
    {
      name: "gradle-wrapper" as const,
      available: wrapperAvailable,
      detail: wrapperPath,
    },
    {
      name: "android-sdk" as const,
      available: Boolean(
        process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME,
      ),
      detail: "ANDROID_SDK_ROOT or ANDROID_HOME",
    },
  ];
  return {
    platform: process.platform,
    checks,
    ready: checks.every((check) => check.available),
  };
}
