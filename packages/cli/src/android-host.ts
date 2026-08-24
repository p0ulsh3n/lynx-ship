import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { assert } from "@lynxship/contracts";

const templateRoot = fileURLToPath(
  new URL("../templates/android-host/", import.meta.url),
);

export interface AndroidHostOptions {
  applicationId: string;
  appName: string;
}

export interface AndroidHostResult {
  directory: string;
  applicationId: string;
  packageName: string;
}

function packagePath(packageName: string): string {
  return packageName.split(".").join("/");
}

function validateApplicationId(applicationId: string): void {
  assert(
    /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(applicationId),
    "ANDROID_APPLICATION_ID_INVALID",
    "Android application ID must contain at least two dot-separated Java package segments, for example com.example.myapp.",
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

function safeAppName(value: string): string {
  return value.replace(/[^a-zA-Z0-9 ._-]/g, "").trim() || "Lynx App";
}

export async function initializeAndroidHost(
  root: string,
  options: AndroidHostOptions,
): Promise<AndroidHostResult> {
  validateApplicationId(options.applicationId);
  const android = join(root, "android");
  assert(
    !(await exists(android)),
    "ANDROID_HOST_EXISTS",
    `The Android host already exists at ${android}. LynxShip will not overwrite it.`,
  );

  const packageName = options.applicationId;
  const packageDirectory = join(
    android,
    "app",
    "src",
    "main",
    "java",
    packagePath(packageName),
  );
  await cp(templateRoot, android, { recursive: true, force: false });
  await mkdir(dirname(packageDirectory), { recursive: true });
  await rename(
    join(android, "app", "src", "main", "java", "template"),
    packageDirectory,
  );

  const replacements: Record<string, string> = {
    __APPLICATION_ID__: options.applicationId,
    __PACKAGE_NAME__: packageName,
    __APP_NAME__: safeAppName(options.appName),
  };
  const textFiles = [
    "build.gradle",
    "settings.gradle",
    "gradle.properties",
    "app/build.gradle",
    "app/src/main/AndroidManifest.xml",
    "app/src/main/res/values/strings.xml",
    "app/src/main/res/values/themes.xml",
    "app/src/main/java/__PACKAGE_PATH__/LynxShipApplication.java",
    "app/src/main/java/__PACKAGE_PATH__/MainActivity.java",
    "app/src/main/java/__PACKAGE_PATH__/ProjectTemplateProvider.java",
  ];
  for (const relativeFile of textFiles) {
    const target = join(
      android,
      relativeFile.replace("__PACKAGE_PATH__", packagePath(packageName)),
    );
    let content = await readFile(target, "utf8");
    for (const [placeholder, value] of Object.entries(replacements))
      content = content.replaceAll(placeholder, value);
    await writeFile(target, content, "utf8");
  }

  if (process.platform !== "win32")
    await chmod(join(android, "gradlew"), 0o755);

  return {
    directory: android,
    applicationId: options.applicationId,
    packageName,
  };
}

export function suggestedAndroidApplicationId(root: string): string {
  const project = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `com.example.${project || "lynxapp"}`;
}
