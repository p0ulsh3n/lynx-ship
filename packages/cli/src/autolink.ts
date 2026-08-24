import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assert, type Platform } from "@lynxship/contracts";

interface LibraryManifest {
  platforms?: { android?: unknown; ios?: unknown };
}

export interface AutolinkPlatformStatus {
  required: boolean;
  ready: boolean;
  manifests: string[];
  reason: string;
}

export interface AutolinkStatus {
  android: AutolinkPlatformStatus;
  ios: AutolinkPlatformStatus;
}

const emptyStatus = (): AutolinkPlatformStatus => ({
  required: false,
  ready: true,
  manifests: [],
  reason: "No Lynx native-library manifest found",
});

function findNodeModuleRoots(root: string): string[] {
  const roots: string[] = [];
  let current = root;
  while (true) {
    roots.push(join(current, "node_modules"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

async function findManifests(root: string): Promise<string[]> {
  const result = new Set<string>();
  const visited = new Set<string>();

  async function visit(current: string, depth: number): Promise<void> {
    if (depth > 7) return;
    let directory: string;
    try {
      if (!(await stat(current)).isDirectory()) return;
      directory = await realpath(current);
    } catch {
      return;
    }
    if (visited.has(directory)) return;
    visited.add(directory);
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = join(current, entry.name);
      if (entry.isFile() && entry.name === "lynx.lib.json") {
        result.add(file);
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
          // Broken package links are ignored; the package manager reports them.
        }
      }
    }
  }

  for (const moduleRoot of findNodeModuleRoots(root))
    await visit(moduleRoot, 0);
  return [...result].sort();
}

async function hasFile(file: string): Promise<boolean> {
  return existsSync(file);
}

async function platformStatus(
  root: string,
  platform: Platform,
  manifests: string[],
): Promise<AutolinkPlatformStatus> {
  const relevant: string[] = [];
  for (const file of manifests) {
    try {
      const manifest = JSON.parse(
        await readFile(file, "utf8"),
      ) as LibraryManifest;
      if (manifest.platforms?.[platform] !== undefined) relevant.push(file);
    } catch {
      relevant.push(file);
    }
  }
  if (relevant.length === 0) return emptyStatus();

  if (platform === "android") {
    const settingsFile = [
      join(root, "android", "settings.gradle"),
      join(root, "android", "settings.gradle.kts"),
    ].find((file) => existsSync(file));
    const appFile = [
      join(root, "android", "app", "build.gradle"),
      join(root, "android", "app", "build.gradle.kts"),
    ].find((file) => existsSync(file));
    const settingsText = settingsFile
      ? await readFile(settingsFile, "utf8")
      : "";
    const appText = appFile ? await readFile(appFile, "utf8") : "";
    const ready =
      settingsText.includes("org.lynxsdk.library-settings") &&
      appText.includes("org.lynxsdk.library-build");
    return {
      required: true,
      ready,
      manifests: relevant,
      reason: ready
        ? "Lynx Android Autolink plugins are enabled"
        : "Enable org.lynxsdk.library-settings in settings.gradle and org.lynxsdk.library-build in app/build.gradle",
    };
  }

  const podfile = join(root, "ios", "Podfile");
  const podfileText = (await hasFile(podfile))
    ? await readFile(podfile, "utf8")
    : "";
  const ready =
    podfileText.includes("cocoapods-lynx-library") &&
    podfileText.includes("use_lynx_library!");
  return {
    required: true,
    ready,
    manifests: relevant,
    reason: ready
      ? "Lynx iOS Autolink CocoaPods integration is enabled"
      : "Add cocoapods-lynx-library and use_lynx_library! to ios/Podfile",
  };
}

export async function inspectAutolink(root: string): Promise<AutolinkStatus> {
  const manifests = await findManifests(root);
  return {
    android: await platformStatus(root, "android", manifests),
    ios: await platformStatus(root, "ios", manifests),
  };
}

export async function requireAutolinkReady(
  root: string,
  platform: Platform,
): Promise<AutolinkPlatformStatus> {
  const status = (await inspectAutolink(root))[platform];
  assert(
    !status.required || status.ready,
    platform === "android"
      ? "LYNX_AUTOLINK_ANDROID_REQUIRED"
      : "LYNX_AUTOLINK_IOS_REQUIRED",
    status.reason,
    { platform, manifests: status.manifests },
  );
  return status;
}
