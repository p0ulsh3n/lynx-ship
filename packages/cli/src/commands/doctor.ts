import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { microHsHostTriple } from "@lynxship/microhs";
import { assert } from "@lynxship/contracts";
import { detectLynxFramework } from "../frameworks.js";
import { loadConfig, platformValue, resolveProfile } from "../config.js";
import { hasAndroidHost } from "../android-build.js";
import { hasIosHost } from "../ios-build.js";
import { credentialStorageDescription } from "../secure-store.js";
import { inspectAutolink } from "../autolink.js";
import { commandExists } from "../process-runner.js";
import { confirm } from "../prompt.js";
import {
  fixAndroidToolchain,
  inspectAndroidToolchain,
} from "../android-toolchain.js";
import { inspectIosToolchain } from "../ios-toolchain.js";
import { inspectProjectPlugins } from "../plugins.js";
import {
  inspectDesktopTarget,
  inspectHarmonyTarget,
  inspectWebTarget,
} from "../target-toolchain.js";
import { findLockfile, exists } from "../runtime/project.js";
import type { BoxRow, CliUi } from "../ui/index.js";

export interface DoctorCommandContext {
  root: string;
  args: readonly string[];
  ui: CliUi;
  flag: (name: string, fallback?: string | null) => string | null;
  printValue: (
    value: unknown,
    view?: { title: string; rows: BoxRow[]; done: string },
  ) => void;
  readConfigurationStatus: () => Promise<{ r2: boolean; android: boolean }>;
}

export async function runDoctor(context: DoctorCommandContext): Promise<void> {
  const { root, args, ui, flag, printValue, readConfigurationStatus } = context;
  const config = await loadConfig(root);
  const configuration = await readConfigurationStatus();
  const doctorPlatform = platformValue(flag("--platform", "android")!);
  const autolink =
    doctorPlatform === "android" || doctorPlatform === "ios"
      ? await inspectAutolink(root)
      : undefined;
  const autolinkForPlatform =
    autolink && (doctorPlatform === "android" || doctorPlatform === "ios")
      ? autolink[doctorPlatform]
      : undefined;
  const framework = await detectLynxFramework(root);
  const packageLockfile = await findLockfile(root);
  const lockfile =
    packageLockfile ??
    (framework.framework === "miso" && (await exists(join(root, "flake.lock")))
      ? join(root, "flake.lock")
      : null);
  const credentialStore = credentialStorageDescription();
  const nativeCredentialStore = !credentialStore.includes("owner-only");
  const androidHost =
    doctorPlatform === "android" ? await hasAndroidHost(root) : false;
  const doctorProfileName = flag("--profile", "production")!;
  const doctorProfile = resolveProfile(config, doctorProfileName);
  const targetToolchain =
    doctorPlatform === "web"
      ? await inspectWebTarget(root, doctorProfile)
      : doctorPlatform === "harmony"
        ? await inspectHarmonyTarget(root, doctorProfile)
        : doctorPlatform === "desktop"
          ? await inspectDesktopTarget(root, doctorProfile)
          : undefined;
  assert(
    !args.includes("--fix") || doctorPlatform === "android",
    "CLI_DOCTOR_FIX_PLATFORM",
    "`doctor --fix` currently repairs Android SDK packages; run it with `--platform android`.",
  );
  assert(
    !args.includes("--fix") || ui.interactive,
    "CLI_INTERACTIVE_REQUIRED",
    "Run `lynxship doctor --platform android --fix` in an interactive terminal.",
  );
  let androidToolchain =
    doctorPlatform === "android"
      ? await inspectAndroidToolchain(root)
      : undefined;
  const iosToolchain =
    doctorPlatform === "ios"
      ? await inspectIosToolchain(
          root,
          doctorProfile,
          doctorProfile.ios?.simulator || doctorProfileName === "simulator"
            ? "simulator"
            : "device",
        )
      : undefined;
  if (androidToolchain && args.includes("--fix")) {
    await fixAndroidToolchain(
      root,
      androidToolchain,
      (message) => confirm(message),
      (line) => ui.info(line),
    );
    androidToolchain = await inspectAndroidToolchain(root);
  }
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeSupported = nodeMajor >= 22;
  const nodeRecommended = nodeMajor % 2 === 0;
  const misoCompiler =
    framework.framework === "miso"
      ? (doctorProfile.miso?.compiler ?? "ghcjs")
      : undefined;
  const microhsConfig = doctorProfile.miso?.microhs;
  const microhsBinary =
    microhsConfig?.binary ?? process.env.LYNXSHIP_MICROHS_BINARY;
  const microhsBinaryReady = Boolean(
    microhsBinary && existsSync(resolve(root, microhsBinary)),
  );
  const microhsManifestPath =
    microhsConfig?.manifest ?? process.env.LYNXSHIP_MICROHS_MANIFEST;
  const microhsManifestReady = Boolean(
    (microhsManifestPath && existsSync(resolve(root, microhsManifestPath))) ||
    microhsConfig?.manifestUrl ||
    process.env.LYNXSHIP_MICROHS_MANIFEST_URL,
  );
  let microhsHost: string | undefined;
  try {
    microhsHost = microHsHostTriple();
  } catch {
    microhsHost = undefined;
  }
  const pluginReport = await inspectProjectPlugins(root, config);
  const invalidPlugins = pluginReport.plugins.filter(
    (plugin) => plugin.status !== "ready",
  );
  const checks = [
    {
      name: "lynx-framework",
      ok: framework.framework !== "unknown",
      status:
        framework.framework === "unknown"
          ? ("warn" as const)
          : framework.experimental
            ? ("warn" as const)
            : ("pass" as const),
      value:
        framework.framework === "unknown"
          ? "unknown · verify the official Lynx/Rspeedy integration"
          : framework.label +
            " · " +
            framework.evidence +
            (framework.experimental ? " · early access" : ""),
    },
    ...(framework.framework === "miso" && misoCompiler !== "microhs"
      ? [
          {
            name: "miso-nix",
            ok: commandExists("nix"),
            status: commandExists("nix")
              ? ("pass" as const)
              : ("fail" as const),
            value: commandExists("nix")
              ? "Nix detected"
              : "missing · fix: install Nix and rerun doctor",
          },
        ]
      : framework.framework === "miso"
        ? [
            {
              name: "miso-compiler",
              ok: true,
              status: "pass" as const,
              value: "MicroHs selected explicitly",
            },
            {
              name: "miso-microhs-host",
              ok: Boolean(microhsHost),
              status: microhsHost ? ("pass" as const) : ("fail" as const),
              value:
                microhsHost ??
                "unsupported host architecture · fix: use a supported MicroHs host or compiler=ghcjs",
            },
            {
              name: "miso-microhs-toolchain",
              ok: microhsBinaryReady || microhsManifestReady,
              status:
                microhsBinaryReady || microhsManifestReady
                  ? ("pass" as const)
                  : ("fail" as const),
              value: microhsBinaryReady
                ? "external MicroHs binary found"
                : microhsManifestReady
                  ? "pinned release manifest configured · downloaded on build"
                  : "missing · fix: configure build.<profile>.miso.microhs.binary or manifestUrl",
            },
            {
              name: "miso-microhs-adapter",
              ok: Boolean(microhsConfig?.adapter?.command),
              status: microhsConfig?.adapter?.command
                ? ("pass" as const)
                : ("fail" as const),
              value: microhsConfig?.adapter?.command
                ? "adapter command configured"
                : "missing · fix: configure build.<profile>.miso.microhs.adapter",
            },
          ]
        : []),
    {
      name: "node",
      ok: nodeSupported,
      status: !nodeSupported
        ? ("fail" as const)
        : nodeRecommended
          ? ("pass" as const)
          : ("warn" as const),
      value: !nodeSupported
        ? `${process.version} · fix: use Node 24 LTS`
        : nodeRecommended
          ? process.version
          : `${process.version} · recommended: Node 24 LTS`,
    },
    {
      name: "dependency-lockfile",
      ok: Boolean(lockfile),
      status: lockfile ? "pass" : "fail",
      value: lockfile ?? "missing · fix: pnpm install (or npm install)",
    },
    {
      name: "lynxship.json",
      ok: config.projectId !== undefined,
      status: config.projectId ? "pass" : "fail",
      value: config.projectId ? "found" : "missing · fix: lynxship init",
    },
    {
      name: "lynxship-plugins",
      ok: invalidPlugins.length === 0,
      status:
        invalidPlugins.length === 0 ? ("pass" as const) : ("fail" as const),
      value:
        invalidPlugins.length === 0
          ? pluginReport.configured === 0
            ? "none configured"
            : `${pluginReport.configured} plugin(s) ready`
          : `${invalidPlugins.map((plugin) => plugin.name).join(", ")} · fix: lynxship plugin doctor`,
    },
    {
      name: "credential-store",
      ok: true,
      status: nativeCredentialStore ? ("pass" as const) : ("warn" as const),
      value: nativeCredentialStore
        ? credentialStore
        : `${credentialStore} · use CI secret variables or install Linux Secret Service`,
    },
    ...(doctorPlatform === "android"
      ? [
          {
            name: "android-host",
            ok: androidHost,
            status: androidHost ? ("pass" as const) : ("fail" as const),
            value: androidHost
              ? "Gradle host found"
              : "missing · fix: lynxship android host init --application-id com.example.myapp",
          },
          ...(androidToolchain?.checks ?? []).map((toolchainCheck) => ({
            name: toolchainCheck.name,
            ok: toolchainCheck.ok,
            status: toolchainCheck.status,
            value:
              toolchainCheck.fix && toolchainCheck.status !== "pass"
                ? `${toolchainCheck.value} · fix: ${toolchainCheck.fix}`
                : toolchainCheck.value,
          })),
        ]
      : doctorPlatform === "ios"
        ? (iosToolchain?.checks ?? [])
            .filter((toolchainCheck) => toolchainCheck.name !== "ios-host")
            .map((toolchainCheck) => ({
              name: toolchainCheck.name,
              ok: toolchainCheck.ok,
              status: toolchainCheck.status,
              value:
                toolchainCheck.fix && toolchainCheck.status !== "pass"
                  ? `${toolchainCheck.value} · fix: ${toolchainCheck.fix}`
                  : toolchainCheck.value,
            }))
        : (targetToolchain?.checks ?? []).map((toolchainCheck) => ({
            name: toolchainCheck.name,
            ok: toolchainCheck.ok,
            status: toolchainCheck.status,
            value:
              toolchainCheck.fix && toolchainCheck.status !== "pass"
                ? `${toolchainCheck.value} · fix: ${toolchainCheck.fix}`
                : toolchainCheck.value,
          }))),
    {
      name: "cloudflare-r2",
      ok:
        doctorPlatform === "ios" && doctorProfile.ios?.simulator
          ? true
          : configuration.r2,
      status:
        doctorPlatform === "ios" && doctorProfile.ios?.simulator
          ? ("pass" as const)
          : configuration.r2
            ? ("pass" as const)
            : ("fail" as const),
      value:
        doctorPlatform === "ios" && doctorProfile.ios?.simulator
          ? "not required for iOS Simulator"
          : configuration.r2
            ? "configured"
            : "missing · fix: lynxship storage configure",
    },
    ...(doctorPlatform === "android"
      ? [
          {
            name: "android-signing",
            ok: configuration.android,
            status: configuration.android
              ? ("pass" as const)
              : ("fail" as const),
            value: configuration.android
              ? "configured"
              : "missing · fix: lynxship android configure",
          },
        ]
      : doctorPlatform === "ios"
        ? [
            {
              name: "ios-host",
              ok: process.platform === "darwin" && hasIosHost(root),
              status:
                process.platform === "darwin" && hasIosHost(root)
                  ? ("pass" as const)
                  : ("fail" as const),
              value:
                process.platform === "darwin" && hasIosHost(root)
                  ? "Xcode host found"
                  : "missing · fix: use macOS, then lynxship ios host init --bundle-identifier com.example.myapp",
            },
          ]
        : []),
    ...(autolinkForPlatform
      ? [
          {
            name: `lynx-autolink-${doctorPlatform}`,
            ok: autolinkForPlatform.ready,
            status: autolinkForPlatform.ready
              ? ("pass" as const)
              : ("fail" as const),
            value: autolinkForPlatform.ready
              ? autolinkForPlatform.reason
              : `${autolinkForPlatform.reason} · fix: install the native plugin, then run autolink codegen`,
          },
        ]
      : []),
  ];
  const result = {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
  const hasWarnings = checks.some((check) => check.status === "warn");
  if (!result.ok) ui.warn("One or more environment checks failed");
  else if (hasWarnings)
    ui.warn("Environment is usable, but one recommendation needs attention");
  if (!result.ok) process.exitCode = 1;
  printValue(result, {
    title: "Doctor result",
    rows: checks.map((check) => ({
      label: check.name,
      value: `${check.status} · ${check.value}`,
      valueColor:
        check.status === "pass"
          ? "green"
          : check.status === "warn"
            ? "yellow"
            : "red",
    })),
    done: result.ok
      ? hasWarnings
        ? "Environment is usable; review the recommendation when convenient."
        : "Environment looks ready."
      : "Fix the failed checks before building.",
  });
  return;
}
