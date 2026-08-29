import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assert } from "@lynxship/contracts";
import { captureProcess, runProcess } from "../process-runner.js";

interface SimulatorDevice {
  udid: string;
  state: string;
  isAvailable?: boolean;
}

async function listSimulatorDevices(
  root: string,
  filter: "booted" | "available",
): Promise<SimulatorDevice[]> {
  const result = await captureProcess(
    "xcrun",
    ["simctl", "list", "devices", filter, "--json"],
    { cwd: root },
  );
  if (result.code !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout) as {
      devices?: Record<string, SimulatorDevice[]>;
    };
    return Object.values(parsed.devices ?? {}).flat();
  } catch {
    return [];
  }
}

export async function selectSimulatorDevice(
  root: string,
  requested?: string,
): Promise<string> {
  if (requested) return requested;
  const booted = (await listSimulatorDevices(root, "booted"))[0];
  if (booted) return booted.udid;
  const available = (await listSimulatorDevices(root, "available")).find(
    (device) => device.isAvailable !== false,
  );
  assert(
    available,
    "IOS_SIMULATOR_RUNTIME_REQUIRED",
    "No available iOS Simulator device was found. Install an iOS Simulator runtime in Xcode, then rerun the build.",
  );
  return available.udid;
}

export async function ensureSimulatorBooted(
  root: string,
  device: string,
  onEvent?: (message: string) => void,
  quiet?: boolean,
): Promise<void> {
  const booted = (await listSimulatorDevices(root, "booted")).some(
    (entry) => entry.udid === device,
  );
  if (!booted) {
    onEvent?.(`Booting iOS Simulator ${device}…`);
    await runProcess("xcrun", ["simctl", "boot", device], {
      cwd: root,
      quiet,
      onOutput: onEvent,
    });
  }
  await runProcess("xcrun", ["simctl", "bootstatus", device, "-b"], {
    cwd: root,
    quiet,
    onOutput: onEvent,
  });
}

export async function findSimulatorApp(
  derivedData: string,
  configuration: string,
  scheme: string,
): Promise<string> {
  const products = join(
    derivedData,
    "Build",
    "Products",
    `${configuration}-iphonesimulator`,
  );
  const expected = join(products, `${scheme}.app`);
  if (existsSync(expected)) return expected;
  const entries = await readdir(products, { withFileTypes: true }).catch(
    () => [],
  );
  const app = entries.find(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
  );
  assert(
    app,
    "IOS_SIMULATOR_ARTIFACT_MISSING",
    `Xcode did not produce a Simulator .app under ${products}`,
  );
  return join(products, app.name);
}

export async function findArchiveApp(archivePath: string): Promise<string> {
  const products = join(archivePath, "Products", "Applications");
  const entries = await readdir(products, { withFileTypes: true }).catch(
    () => [],
  );
  const app = entries.find(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
  );
  assert(
    app,
    "IOS_ARCHIVE_ARTIFACT_MISSING",
    `Xcode did not produce an app bundle under ${products}`,
  );
  return join(products, app.name);
}
