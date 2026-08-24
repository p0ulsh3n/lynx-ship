import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, type Platform } from "@lynxship/contracts";

export interface OtaHostStatus {
  platform: Platform;
  detected: boolean;
  files: string[];
  missing: string[];
}

const sourceExtensions = new Set([".java", ".kt", ".swift", ".m", ".mm"]);

async function sourceFiles(
  root: string,
  platform: Platform,
): Promise<string[]> {
  const files: string[] = [];
  const directory = join(root, platform);

  async function visit(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (["build", "Pods", "DerivedData", ".gradle"].includes(entry.name))
        continue;
      const file = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      const extension = entry.name.slice(entry.name.lastIndexOf("."));
      if (entry.isFile() && sourceExtensions.has(extension)) files.push(file);
    }
  }

  await visit(directory);
  return files;
}

export async function inspectOtaHost(
  root: string,
  platform: Platform,
): Promise<OtaHostStatus> {
  const files = await sourceFiles(root, platform);
  const contents = await Promise.all(
    files.map(async (file) => readFile(file, "utf8").catch(() => "")),
  );
  const text = contents.join("\n");
  const required = [
    "LynxShipOtaClient",
    "beginLaunch",
    "markLaunchSuccess",
    "openActiveAsset",
  ];
  return {
    platform,
    detected: files.length > 0,
    files,
    missing: required.filter((value) => !text.includes(value)),
  };
}

export async function requireOtaHost(
  root: string,
  platform: Platform,
): Promise<OtaHostStatus> {
  const status = await inspectOtaHost(root, platform);
  assert(
    status.detected && status.missing.length === 0,
    "OTA_HOST_INTEGRATION_REQUIRED",
    `The ${platform} native host is not integrated with the LynxShip OTA client. Missing: ${status.missing.join(", ") || "native host source"}`,
    status as unknown as Record<string, unknown>,
  );
  return status;
}
