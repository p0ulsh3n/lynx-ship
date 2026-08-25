import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { commandExists } from "./process-runner.js";
import { hasDesktopHost, resolveDesktopPackScript } from "./desktop-build.js";
import { hasHarmonyHost, harmonyToolchain } from "./harmony-build.js";
import { hasWebConfiguration } from "./web-build.js";
import { inspectDesktopSigning } from "./desktop-signing.js";
import type { BuildProfile } from "./config.js";

export type TargetCheckStatus = "pass" | "warn" | "fail";

export interface TargetCheck {
  name: string;
  status: TargetCheckStatus;
  ok: boolean;
  value: string;
  fix?: string;
}

export interface TargetToolchainReport {
  ok: boolean;
  checks: TargetCheck[];
}

function check(
  name: string,
  status: TargetCheckStatus,
  value: string,
  fix?: string,
): TargetCheck {
  return { name, status, ok: status !== "fail", value, fix };
}

function packageManifest(root: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
} {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
  } catch {
    return {};
  }
}

function hasDependency(
  manifest: ReturnType<typeof packageManifest>,
  name: string,
): boolean {
  return Boolean(
    manifest.dependencies?.[name] || manifest.devDependencies?.[name],
  );
}

export async function inspectWebTarget(
  root: string,
  profile: BuildProfile,
): Promise<TargetToolchainReport> {
  const manifest = packageManifest(root);
  const configured = hasWebConfiguration(root);
  const customScript = Boolean(
    profile.web?.script || manifest.scripts?.["build:web"],
  );
  const hasRspeedy = hasDependency(manifest, "@lynx-js/rspeedy");
  const checks = [
    check(
      "web-configuration",
      configured ? "pass" : "fail",
      configured
        ? "Lynx Web environment configured"
        : "missing lynx.config.* or build:web script",
      configured
        ? undefined
        : "Configure environments.web in lynx.config.* or add a build:web script, then rerun lynxship doctor --platform web",
    ),
    check(
      "web-build-tool",
      hasRspeedy || customScript ? "pass" : "fail",
      hasRspeedy
        ? "@lynx-js/rspeedy detected"
        : customScript
          ? "project web build script detected"
          : "@lynx-js/rspeedy not found",
      hasRspeedy || customScript
        ? undefined
        : "Install the project Lynx Web toolchain with the package manager, then rerun lynxship doctor --platform web",
    ),
    check(
      "web-output",
      "warn",
      "dist/*.web.bundle is checked during the build",
      "Run lynxship build --platform web --profile production",
    ),
  ];
  return { ok: checks.every((item) => item.status !== "fail"), checks };
}

function harmonySignTool(
  root: string,
  profile: BuildProfile,
): string | undefined {
  const candidates = [
    profile.harmony?.signTool
      ? resolve(root, profile.harmony.signTool)
      : undefined,
    process.env.LYNXSHIP_HAP_SIGN_TOOL,
    process.env.DEVECO_HAP_SIGN_TOOL,
    process.env.HOS_SDK_HOME
      ? join(process.env.HOS_SDK_HOME, "toolchains", "lib", "hap-sign-tool.jar")
      : undefined,
    process.env.DEVECO_SDK_HOME
      ? join(
          process.env.DEVECO_SDK_HOME,
          "toolchains",
          "lib",
          "hap-sign-tool.jar",
        )
      : undefined,
  ].filter((value): value is string => Boolean(value));
  return candidates.find((value) => existsSync(value));
}

export async function inspectHarmonyTarget(
  root: string,
  profile: BuildProfile,
): Promise<TargetToolchainReport> {
  const host = hasHarmonyHost(root);
  const tools = harmonyToolchain(root);
  const signTool = harmonySignTool(root, profile);
  const checks = [
    check(
      "harmony-host",
      host ? "pass" : "fail",
      host
        ? "Hvigor Harmony host found"
        : "missing official harmony/ host files",
      host
        ? undefined
        : "Add the official Lynx Harmony host with harmony/hvigorw, hvigorfile.ts, build-profile.json5 and oh-package.json5",
    ),
    check(
      "ohpm",
      tools.ohpm ? "pass" : "fail",
      tools.ohpm ? "ohpm detected" : "missing",
      tools.ohpm
        ? undefined
        : "Install DevEco Studio/OpenHarmony SDK and make ohpm available on PATH",
    ),
    check(
      "harmony-java",
      commandExists("java") ? "pass" : "fail",
      commandExists("java") ? "Java detected" : "missing",
      commandExists("java")
        ? undefined
        : "Install the JDK required by the pinned DevEco/Hvigor project",
    ),
    check(
      "hap-sign-tool",
      signTool ? "pass" : "fail",
      signTool ? "official hap-sign-tool.jar detected" : "missing",
      signTool
        ? undefined
        : "Set LYNXSHIP_HAP_SIGN_TOOL or build.<profile>.harmony.signTool to the official hap-sign-tool.jar",
    ),
    check(
      "hdc",
      tools.hdc ? "pass" : "warn",
      tools.hdc
        ? "hdc detected"
        : "missing · required only for lynxship run/logs",
      tools.hdc
        ? undefined
        : "Install the OpenHarmony SDK platform tools before installing on a device",
    ),
  ];
  return { ok: checks.every((item) => item.status !== "fail"), checks };
}

export async function inspectDesktopTarget(
  root: string,
  profile?: BuildProfile,
): Promise<TargetToolchainReport> {
  const host = await hasDesktopHost(root, profile);
  const manifest = packageManifest(root);
  const builder =
    Boolean(resolveDesktopPackScript(manifest, profile)) ||
    hasDependency(manifest, "@lynx-js/lynxtron-builder") ||
    hasDependency(manifest, "electron-builder") ||
    existsSync(join(root, "electron-builder.yml")) ||
    existsSync(join(root, "electron-builder.yaml")) ||
    existsSync(join(root, "electron-builder.json"));
  const signing = await inspectDesktopSigning(root);
  const checks = [
    check(
      "desktop-host",
      host ? "pass" : "fail",
      host
        ? "Lynxtron/Electron desktop host found"
        : "missing Lynxtron host or pack script",
      host
        ? undefined
        : "Use the official Lynxtron template and configure @lynx-js/lynxtron-builder, electron-builder.yml or a pack script",
    ),
    check(
      "desktop-packager",
      builder ? "pass" : "fail",
      builder
        ? "Lynxtron/Electron Builder packaging entry detected"
        : "packaging entry not found",
      builder
        ? undefined
        : "Install @lynx-js/lynxtron-builder and add a pack script, then rerun lynxship doctor --platform desktop",
    ),
    check(
      "desktop-platform",
      process.platform === "win32" || process.platform === "darwin"
        ? "pass"
        : "warn",
      process.platform === "win32" || process.platform === "darwin"
        ? `${process.platform} desktop target`
        : `${process.platform} host · verify the Lynxtron target explicitly`,
      process.platform === "win32" || process.platform === "darwin"
        ? undefined
        : "Run the desktop build on the target OS supported by the project’s Lynxtron/electron-builder configuration",
    ),
    check(
      "desktop-signing",
      signing.status === "configured" || signing.status === "not-required"
        ? "pass"
        : signing.status === "unknown"
          ? "warn"
          : "fail",
      signing.value,
      signing.fix,
    ),
  ];
  return { ok: checks.every((item) => item.status !== "fail"), checks };
}
