import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assert, type MobilePlatform } from "@lynxship/contracts";

interface LibraryManifest {
  platforms?: {
    android?: {
      packageName?: unknown;
      sourceDir?: unknown;
      podspecPath?: unknown;
    };
    ios?: {
      packageName?: unknown;
      sourceDir?: unknown;
      podspecPath?: unknown;
    };
  };
}

export interface AutolinkPlatformStatus {
  required: boolean;
  ready: boolean;
  manifests: string[];
  reason: string;
  issues?: string[];
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

function packageRoot(manifestPath: string): string {
  return dirname(manifestPath);
}

function platformSourceDirectory(
  manifestPath: string,
  platform: MobilePlatform,
  manifest: LibraryManifest,
): string {
  const definition = manifest.platforms?.[platform];
  const sourceDir =
    definition && typeof definition.sourceDir === "string"
      ? definition.sourceDir
      : platform;
  return join(packageRoot(manifestPath), sourceDir);
}

async function findNativeSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (["build", "Pods", ".gradle", "node_modules"].includes(entry.name))
        continue;
      const file = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (
        entry.isFile() &&
        /\.(?:java|kt|m|mm|h|swift|podspec)$/i.test(entry.name)
      ) {
        files.push(file);
      }
    }
  }

  await visit(directory);
  return files;
}

async function manifestIssues(
  file: string,
  platform: MobilePlatform,
): Promise<string[]> {
  const issues: string[] = [];
  let manifest: LibraryManifest;
  try {
    manifest = JSON.parse(await readFile(file, "utf8")) as LibraryManifest;
  } catch {
    return ["lynx.lib.json is not valid JSON"];
  }
  const definition = manifest.platforms?.[platform];
  if (!definition || typeof definition !== "object") return issues;
  const root = packageRoot(file);
  if (platform === "android") {
    if (typeof definition.packageName !== "string" || !definition.packageName)
      issues.push("platforms.android.packageName is required");
    if (
      definition.sourceDir !== undefined &&
      (typeof definition.sourceDir !== "string" || !definition.sourceDir)
    )
      issues.push("platforms.android.sourceDir must be a non-empty string");
  }
  if (platform === "ios" && definition.podspecPath !== undefined) {
    if (typeof definition.podspecPath !== "string" || !definition.podspecPath)
      issues.push("platforms.ios.podspecPath must be a non-empty string");
  }
  const sourceDirectory = platformSourceDirectory(file, platform, manifest);
  if (!existsSync(sourceDirectory))
    issues.push(`native source directory is missing: ${sourceDirectory}`);
  if (platform === "ios") {
    const podspec =
      typeof definition.podspecPath === "string"
        ? join(root, definition.podspecPath)
        : (await findNativeSourceFiles(sourceDirectory)).find((candidate) =>
            candidate.endsWith(".podspec"),
          );
    if (definition.podspecPath && !existsSync(podspec ?? ""))
      issues.push(`iOS podspec is missing: ${podspec}`);
  }
  return issues;
}

async function capabilityNames(
  file: string,
  platform: MobilePlatform,
): Promise<string[]> {
  let manifest: LibraryManifest;
  try {
    manifest = JSON.parse(await readFile(file, "utf8")) as LibraryManifest;
  } catch {
    return [];
  }
  const source = platformSourceDirectory(file, platform, manifest);
  const files = await findNativeSourceFiles(source);
  const names = new Set<string>();
  for (const nativeFile of files) {
    const text = await readFile(nativeFile, "utf8").catch(() => "");
    const expression =
      /@Lynx(?:NativeModule|Element|Service)\s*\(\s*["']?([A-Za-z0-9_.-]+)/g;
    for (const match of text.matchAll(expression)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return [...names];
}

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
  platform: MobilePlatform,
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

  const issues = (
    await Promise.all(relevant.map((file) => manifestIssues(file, platform)))
  ).flat();

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
    const settingsPlugin =
      settingsText.includes("org.lynxsdk.library-settings") ||
      settingsText.includes("org.lynxsdk.lynx.library-settings");
    const buildPlugin =
      appText.includes("org.lynxsdk.library-build") ||
      appText.includes("org.lynxsdk.lynx.library-build");
    const pluginsReady = settingsPlugin && buildPlugin;
    const ready = pluginsReady && issues.length === 0;
    return {
      required: true,
      ready,
      manifests: relevant,
      ...(issues.length > 0 ? { issues } : {}),
      reason: ready
        ? "Lynx Android Autolink plugins are enabled"
        : issues.length > 0
          ? issues.join("; ")
          : "Enable the Lynx Autolink settings and build plugins in settings.gradle and app/build.gradle (use the IDs matching the project Lynx release)",
    };
  }

  const podfile = join(root, "ios", "Podfile");
  const podfileText = (await hasFile(podfile))
    ? await readFile(podfile, "utf8")
    : "";
  const pluginsReady =
    podfileText.includes("cocoapods-lynx-library") &&
    podfileText.includes("use_lynx_library!");
  const ready = pluginsReady && issues.length === 0;
  return {
    required: true,
    ready,
    manifests: relevant,
    ...(issues.length > 0 ? { issues } : {}),
    reason: ready
      ? "Lynx iOS Autolink CocoaPods integration is enabled"
      : issues.length > 0
        ? issues.join("; ")
        : "Add cocoapods-lynx-library and use_lynx_library! to ios/Podfile",
  };
}

export async function inspectAutolink(root: string): Promise<AutolinkStatus> {
  const manifests = await findManifests(root);
  const status = {
    android: await platformStatus(root, "android", manifests),
    ios: await platformStatus(root, "ios", manifests),
  };
  for (const platform of ["android", "ios"] as const) {
    const owners = new Map<string, string>();
    for (const manifest of status[platform].manifests) {
      for (const name of await capabilityNames(manifest, platform)) {
        const owner = owners.get(name);
        if (owner) {
          const issue = `duplicate ${platform} native capability '${name}' in ${owner} and ${manifest}`;
          status[platform].issues ??= [];
          status[platform].issues.push(issue);
          status[platform].ready = false;
          status[platform].reason = status[platform].issues.join("; ");
        } else {
          owners.set(name, manifest);
        }
      }
    }
  }
  return status;
}

export async function requireAutolinkReady(
  root: string,
  platform: MobilePlatform,
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
