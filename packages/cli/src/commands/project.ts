import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { assert, type Platform } from "@lynxship/contracts";
import { detectLynxFramework } from "../frameworks.js";
import {
  hasAndroidHost,
  isSupportedAndroidPlatform,
} from "../android-build.js";
import {
  initializeAndroidHost,
  suggestedAndroidApplicationId,
} from "../android-host.js";
import {
  initializeIosHost,
  suggestedIosBundleIdentifier,
} from "../ios-host.js";
import { hasIosHost } from "../ios-build.js";
import {
  DEFAULT_CONFIG,
  resolveProfile,
  type LynxShipConfig,
} from "../config.js";
import { hasHarmonyHost } from "../harmony-build.js";
import { hasWebConfiguration } from "../web-build.js";
import { hasDesktopHost } from "../desktop-build.js";
import { exists } from "../runtime/project.js";
import type { CliUi } from "../ui/index.js";
import { loadAppConfig } from "../app-config.js";

export interface ProjectCommandContext {
  root: string;
  ui: CliUi;
  flag: (name: string, fallback?: string | null) => string | null;
  prompt: (label: string, fallback: string) => Promise<string>;
}

export async function looksLikeLynxProject(
  context: ProjectCommandContext,
): Promise<boolean> {
  const framework = await detectLynxFramework(context.root);
  if (framework.framework !== "unknown") return true;
  const configFiles = [
    "lynx.config.ts",
    "lynx.config.js",
    "lynx.config.mjs",
    "lynx.config.cjs",
    "app.config.ts",
    "app.config.js",
    "app.config.mjs",
    "app.config.cjs",
  ];
  if (
    await Promise.any(
      configFiles.map((file) => exists(join(context.root, file))),
    )
  )
    return true;

  try {
    const packageJson = JSON.parse(
      await readFile(join(context.root, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      scripts?: Record<string, string>;
    };
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    return (
      Object.keys(dependencies).some(
        (name) => name.startsWith("@lynx-js/") || name === "vue-lynx",
      ) ||
      Object.values(packageJson.scripts ?? {}).some((script) =>
        script.includes("rspeedy"),
      )
    );
  } catch {
    return false;
  }
}

export async function initializeProject(
  context: ProjectCommandContext,
): Promise<string> {
  const file = join(context.root, "lynxship.json");
  if (await exists(file)) return file;
  await mkdir(join(context.root, ".lynxship"), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        ...DEFAULT_CONFIG,
        projectId: context.flag("--project-id") ?? randomUUID(),
      },
      null,
      2,
    )}\n`,
  );
  return file;
}

export async function initializeBuildProject(
  context: ProjectCommandContext,
): Promise<void> {
  if (await exists(join(context.root, "lynxship.json"))) return;
  assert(
    await looksLikeLynxProject(context),
    "CLI_PROJECT_REQUIRED",
    "No LynxJS project was detected. Run this command from the project directory or provide `--project-dir`.",
  );
  context.ui.info(
    "No lynxship.json found. Running lynxship init automatically…",
  );
  await initializeProject(context);
  context.ui.success("Created lynxship.json");
}

export async function ensureNativeHostForBuild(
  context: ProjectCommandContext,
  platform: Platform,
  profile: string,
  config: LynxShipConfig,
): Promise<void> {
  if (platform === "android") {
    assert(
      isSupportedAndroidPlatform(),
      "ANDROID_PLATFORM_UNSUPPORTED",
      "Android builds are supported on Windows, macOS, and Linux.",
    );
    if (await hasAndroidHost(context.root)) return;

    assert(
      !(await exists(join(context.root, "android"))),
      "ANDROID_HOST_EXISTS",
      "An android/ directory exists but does not contain a usable Gradle host. LynxShip will not overwrite it; repair it or remove it deliberately, then rerun the build.",
    );
    const appConfig = await loadAppConfig(context.root);
    const configuredApplicationId =
      appConfig?.config.platform?.android?.packageName;
    const suggestedId = suggestedAndroidApplicationId(context.root);
    const applicationId =
      context.flag("--application-id") ??
      configuredApplicationId ??
      (context.ui.interactive
        ? await context.prompt("Android application ID", suggestedId)
        : "");
    assert(
      applicationId,
      "ANDROID_HOST_REQUIRED",
      `No Android Gradle host exists. Run \`lynxship android host init --application-id ${suggestedId}\` or pass --application-id <id> to build in non-interactive mode.`,
    );
    context.ui.info(
      "No Android host found. Creating the official LynxShip host before the build…",
    );
    const result = await initializeAndroidHost(context.root, {
      applicationId,
      appName: appConfig?.config.appName ?? basename(context.root),
    });
    context.ui.success(`Android host created: ${result.directory}`);
    return;
  }

  if (platform === "web") {
    const resolvedProfile = resolveProfile(config, profile);
    assert(
      hasWebConfiguration(context.root) || Boolean(resolvedProfile.web?.script),
      "WEB_CONFIGURATION_REQUIRED",
      "No Lynx Web configuration was detected. Add environments.web to lynx.config.* or configure build.<profile>.web.script.",
    );
    return;
  }

  if (platform === "harmony") {
    assert(
      hasHarmonyHost(context.root),
      "HARMONY_HOST_REQUIRED",
      "No complete HarmonyOS host was found. Add an official Lynx Harmony host under harmony/ before building.",
    );
    return;
  }

  if (platform === "desktop") {
    const resolvedProfile = resolveProfile(config, profile);
    assert(
      await hasDesktopHost(context.root, resolvedProfile),
      "DESKTOP_HOST_REQUIRED",
      "No Lynxtron desktop host was found. Use the official Lynxtron template or configure a pack script before building.",
    );
    return;
  }

  assert(
    process.platform === "darwin",
    "IOS_MACOS_REQUIRED",
    "iOS hosts and IPA builds require macOS with Xcode. Run this build on macOS or a macOS CI worker.",
  );
  const resolvedProfile = resolveProfile(config, profile);
  if (hasIosHost(context.root, resolvedProfile)) return;

  assert(
    !(await exists(join(context.root, "ios"))),
    "IOS_HOST_EXISTS",
    "An ios/ directory exists but does not contain a usable Xcode host. LynxShip will not overwrite it; repair it deliberately, then rerun the build.",
  );
  const suggestedId = suggestedIosBundleIdentifier(context.root);
  const appConfig = await loadAppConfig(context.root);
  const configuredBundleIdentifier =
    appConfig?.config.platform?.ios?.bundleIdentifier;
  const bundleIdentifier =
    context.flag("--bundle-identifier") ??
    configuredBundleIdentifier ??
    (context.ui.interactive
      ? await context.prompt("iOS bundle identifier", suggestedId)
      : "");
  assert(
    bundleIdentifier,
    "IOS_HOST_REQUIRED",
    `No iOS host exists. Run \`lynxship ios host init --bundle-identifier ${suggestedId}\` or pass --bundle-identifier <id> to build in non-interactive mode.`,
  );
  context.ui.info(
    "No iOS host found. Creating the official LynxShip host before the build…",
  );
  const result = await initializeIosHost(context.root, {
    bundleIdentifier,
    appName: appConfig?.config.appName ?? basename(context.root),
    appIcon: context.flag("--icon") ?? appConfig?.config.appIcon ?? undefined,
  });
  context.ui.success(`iOS host created: ${result.directory}`);
}
