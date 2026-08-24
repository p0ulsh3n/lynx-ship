import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import {
  type BuildOrchestrator,
  runtimeFingerprint,
  type RuntimeFingerprintInput,
} from "@lynxship/build-orchestrator";
import { assert, sha256, type Platform } from "@lynxship/contracts";
import type { LynxShipConfig } from "./config.js";

interface FingerprintedFile {
  path: string;
  hash: string;
  size: number;
}

export interface RuntimeFingerprintReport {
  value: string;
  inputs: Record<string, unknown>;
}

export function assertCompatibleBinaryBuild(
  builds: BuildOrchestrator,
  platform: Platform,
  runtimeVersion: string,
): void {
  const successfulBuild = builds
    .list()
    .filter((job) => job.platform === platform && job.state === "success")
    .sort((left, right) => {
      const leftAt = left.transitions.at(-1)?.at ?? "";
      const rightAt = right.transitions.at(-1)?.at ?? "";
      return rightAt.localeCompare(leftAt);
    })[0];
  assert(
    successfulBuild?.runtimeVersion === runtimeVersion,
    "OTA_NATIVE_CHANGE_REQUIRED",
    "Native project inputs changed or no compatible binary build exists. Run `lynxship build` before publishing an OTA update.",
    {
      platform,
      runtimeVersion,
      lastBuildRuntimeVersion: successfulBuild?.runtimeVersion ?? null,
    },
  );
}

const nativeExtensions = new Set([
  ".gradle",
  ".gradle.kts",
  ".h",
  ".java",
  ".json",
  ".kt",
  ".m",
  ".mm",
  ".plist",
  ".podspec",
  ".properties",
  ".rb",
  ".swift",
  ".xml",
  ".entitlements",
  ".storyboard",
  ".xib",
  ".xcconfig",
]);

const nativeNames = new Set([
  "Podfile",
  "Podfile.lock",
  "project.pbxproj",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle-wrapper.properties",
  "AndroidManifest.xml",
]);

const ignoredDirectories = new Set([
  ".gradle",
  ".git",
  ".lynxship",
  "build",
  "DerivedData",
  "Pods",
]);

function normalizedPath(value: string): string {
  return value.split(sep).join("/");
}

async function readJsonFile(
  file: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function fileFingerprint(
  root: string,
  file: string,
): Promise<FingerprintedFile> {
  const data = await readFile(file);
  return {
    path: normalizedPath(relative(root, file)),
    hash: createHash("sha256")
      .update(data.toString("latin1"), "latin1")
      .digest("hex"),
    size: data.byteLength,
  };
}

async function collectNativeFiles(
  root: string,
  directory: string,
): Promise<FingerprintedFile[]> {
  const result: FingerprintedFile[] = [];

  async function visit(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name)) continue;
      const file = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (!entry.isFile()) continue;
      if (
        !nativeNames.has(entry.name) &&
        !nativeExtensions.has(extname(entry.name).toLowerCase())
      )
        continue;
      const details = await stat(file);
      if (details.size > 2_000_000) continue;
      result.push(await fileFingerprint(root, file));
    }
  }

  await visit(directory);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectLynxLibraryManifests(
  root: string,
): Promise<FingerprintedFile[]> {
  const result: FingerprintedFile[] = [];
  const visited = new Set<string>();

  async function visit(current: string, depth: number): Promise<void> {
    if (depth > 7) return;
    let realDirectory: string;
    try {
      realDirectory = (await stat(current)).isDirectory()
        ? await realpath(current)
        : "";
    } catch {
      return;
    }
    if (!realDirectory || visited.has(realDirectory)) return;
    visited.add(realDirectory);
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = join(current, entry.name);
      if (entry.isFile() && entry.name === "lynx.lib.json") {
        result.push(await fileFingerprint(root, file));
        continue;
      }
      if (entry.name === ".cache") continue;
      if (entry.isDirectory()) {
        await visit(file, depth + 1);
        continue;
      }
      if (entry.isSymbolicLink()) {
        try {
          if ((await stat(file)).isDirectory()) await visit(file, depth + 1);
        } catch {
          // Broken package links are ignored; the lockfile still fingerprints them.
        }
      }
    }
  }

  await visit(join(root, "node_modules"), 0);
  const rootManifest = join(root, "lynx.lib.json");
  try {
    result.push(await fileFingerprint(root, rootManifest));
  } catch {
    // A root manifest is optional; package manifests are discovered above.
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function packageManager(packageJson: Record<string, unknown>): string {
  if (typeof packageJson.packageManager === "string")
    return packageJson.packageManager;
  return "pnpm-lock.yaml";
}

function findLockfile(root: string): string | undefined {
  let current = root;
  while (true) {
    for (const name of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
      const file = join(current, name);
      if (existsSync(file)) return file;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function lynxPackages(
  packageJson: Record<string, unknown>,
): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const dependencies = packageJson[field];
    if (!dependencies || typeof dependencies !== "object") continue;
    for (const [name, value] of Object.entries(
      dependencies as Record<string, unknown>,
    )) {
      if (
        (name.startsWith("@lynx-js/") || name.startsWith("lynx")) &&
        typeof value === "string"
      )
        versions[name] = value;
    }
  }
  return Object.fromEntries(
    Object.entries(versions).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export async function inspectRuntimeFingerprint(
  root: string,
  platform: Platform,
  config: LynxShipConfig,
): Promise<RuntimeFingerprintReport> {
  const packageJson =
    (await readJsonFile(join(root, "package.json"))) ??
    ({} as Record<string, unknown>);
  const lockfile = findLockfile(root);
  const lockfileHash = lockfile ? sha256(await readFile(lockfile)) : "none";
  const nativeFiles = await collectNativeFiles(root, join(root, platform));
  const moduleManifests = await collectLynxLibraryManifests(root);
  const nativeHash = sha256(JSON.stringify(nativeFiles));
  const modulesHash = sha256(JSON.stringify(moduleManifests));
  const packages = lynxPackages(packageJson);
  const managerPackageJson = {
    ...packageJson,
    packageManager:
      packageJson.packageManager ?? (lockfile ? basename(lockfile) : undefined),
  };
  const input: RuntimeFingerprintInput = {
    platform,
    config: { update: { protocolVersion: config.update?.protocolVersion } },
    packageManager: packageManager(managerPackageJson),
    lockfileHash,
    native: {
      engine: packages["@lynx-js/lynx"] ?? "unknown",
      sdk: packages["@lynx-js/react"] ?? "unknown",
      nativeHash,
      modulesHash,
    },
  };
  const fingerprint = runtimeFingerprint(input);
  if (config.runtimeVersion?.policy === "manual") {
    assert(
      config.runtimeVersion.value,
      "CONFIG_RUNTIME_VALUE",
      "Manual runtimeVersion.value is required",
    );
    return {
      value: config.runtimeVersion.value,
      inputs: { ...fingerprint.inputs, policy: "manual" },
    };
  }
  return fingerprint;
}
