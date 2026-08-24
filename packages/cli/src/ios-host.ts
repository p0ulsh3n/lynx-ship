import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { assert } from "@lynxship/contracts";

const templateRoot = fileURLToPath(
  new URL("../templates/ios-host/", import.meta.url),
);

export interface IosHostOptions {
  bundleIdentifier: string;
  appName: string;
}

export interface IosHostResult {
  directory: string;
  targetName: string;
  bundleIdentifier: string;
  project: string;
  scheme: string;
  exportOptionsPlist: string;
  bundleScript: string;
  configUpdated: boolean;
}

function validateBundleIdentifier(bundleIdentifier: string): void {
  assert(
    /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*)+$/.test(bundleIdentifier),
    "IOS_BUNDLE_IDENTIFIER_INVALID",
    "iOS bundle identifier must contain at least two dot-separated segments, for example com.example.myapp.",
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function targetName(value: string): string {
  const words = value.match(/[a-zA-Z0-9]+/g) ?? [];
  const result = words
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join("");
  if (result && /^[A-Za-z]/.test(result)) return result;
  return `LynxShip${result || "App"}`;
}

async function textFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await textFiles(path)));
    else if (
      [".h", ".m", ".plist", ".pbxproj", ".swift", ".rb", ".mjs"].some(
        (extension) => entry.name.endsWith(extension),
      ) ||
      entry.name === "Podfile"
    )
      files.push(path);
  }
  return files;
}

async function updateProjectConfig(
  root: string,
  result: Omit<IosHostResult, "configUpdated">,
): Promise<boolean> {
  const configPath = join(root, "lynxship.json");
  if (!(await exists(configPath))) return false;
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    build?: Record<string, Record<string, unknown>>;
  };
  config.build ??= {};
  config.build.production ??= {};
  config.build.production.ios = {
    ...(config.build.production.ios as Record<string, unknown> | undefined),
    project: `ios/${result.targetName}.xcodeproj`,
    scheme: result.scheme,
    configuration: "Release",
    exportOptionsPlist: "ios/ExportOptions.plist",
    bundleScript: "ios/sync-bundle.mjs",
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}

export async function initializeIosHost(
  root: string,
  options: IosHostOptions,
): Promise<IosHostResult> {
  validateBundleIdentifier(options.bundleIdentifier);
  const ios = join(root, "ios");
  assert(
    !(await exists(ios)),
    "IOS_HOST_EXISTS",
    `The iOS host already exists at ${ios}. LynxShip will not overwrite it.`,
  );

  const scheme = targetName(options.appName);
  await cp(templateRoot, ios, { recursive: true, force: false });
  await rename(join(ios, "__IOS_TARGET_NAME__"), join(ios, scheme));
  await rename(
    join(ios, "__IOS_TARGET_NAME__.xcodeproj"),
    join(ios, `${scheme}.xcodeproj`),
  );
  await rename(
    join(ios, scheme, "Hello-Lynx-Bridging-Header.h"),
    join(ios, scheme, `${scheme}-Bridging-Header.h`),
  );

  const files = await textFiles(ios);
  for (const file of files) {
    let content = await readFile(file, "utf8");
    content = content
      .replaceAll("test.Hello-Lynx", options.bundleIdentifier)
      .replaceAll("Hello-Lynx", scheme);
    await writeFile(file, content, "utf8");
  }

  const project = `ios/${scheme}.xcodeproj`;
  const result = {
    directory: ios,
    targetName: scheme,
    bundleIdentifier: options.bundleIdentifier,
    project,
    scheme,
    exportOptionsPlist: "ios/ExportOptions.plist",
    bundleScript: "ios/sync-bundle.mjs",
  };
  const configUpdated = await updateProjectConfig(root, result);
  return { ...result, configUpdated };
}

export function suggestedIosBundleIdentifier(root: string): string {
  const project = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `com.example.${project || "lynxapp"}`;
}
