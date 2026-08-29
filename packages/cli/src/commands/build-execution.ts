import { createHash } from "node:crypto";
import type { BuildJob, MobilePlatform, Platform } from "@lynxship/contracts";
import { assert } from "@lynxship/contracts";
import { BuildOrchestrator } from "@lynxship/build-orchestrator";
import type { JsonRepository } from "@lynxship/db";
import { SubmissionService } from "@lynxship/submit";
import { loadConfig, resolveProfile, type LynxShipConfig } from "../config.js";
import { applyProjectPlugins } from "../plugins.js";
import {
  hasAndroidHost,
  isSupportedAndroidPlatform,
  runRealAndroidBuild,
} from "../android-build.js";
import { hasIosHost, runRealIosBuild } from "../ios-build.js";
import {
  inspectAndroidToolchain,
  formatAndroidToolchainFailure,
} from "../android-toolchain.js";
import {
  inspectIosToolchain,
  formatIosToolchainFailure,
} from "../ios-toolchain.js";
import { runRealHarmonyBuild } from "../harmony-build.js";
import { runRealWebBuild } from "../web-build.js";
import { runRealDesktopBuild } from "../desktop-build.js";
import { inspectRuntimeFingerprint } from "../runtime-fingerprint.js";
import { saveState, type CliState } from "../runtime/state.js";
import { type BoxRow, CliUi, type ProgressHandle } from "../ui/index.js";

export interface BuildExecutionOptions {
  root: string;
  ui: CliUi;
  json: boolean;
  ensureNativeHostForBuild: (
    platform: Platform,
    profile: string,
    config: LynxShipConfig,
  ) => Promise<void>;
  requireAutolinkReady: (
    root: string,
    platform: MobilePlatform,
  ) => Promise<unknown>;
  configuredProjectId: (config: LynxShipConfig) => string;
  printValue: (
    value: unknown,
    view?: { title: string; rows: BoxRow[]; done: string },
  ) => void;
  config: LynxShipConfig;
  profile: string;
  platform: Platform;
  skipUpload: boolean;
  wait: boolean;
  local: boolean;
  state: CliState;
  repository: JsonRepository<CliState>;
  builds: BuildOrchestrator;
  submissions: SubmissionService;
  allowUnsigned: boolean;
  progress?: ProgressHandle;
  progressPrefix?: string;
  onProgress?: (value?: number, label?: string) => void;
  onEvent?: (message: string) => void;
  skipBundleBuild?: boolean;
  simulator?: boolean;
  simulatorDevice?: string;
  simulatorAutostart?: boolean;
}

export async function executeBuild(
  options: BuildExecutionOptions,
  showResult = true,
): Promise<BuildJob> {
  const {
    root,
    ui,
    json,
    ensureNativeHostForBuild,
    requireAutolinkReady,
    configuredProjectId,
    printValue,
    config,
    profile,
    platform,
    skipUpload,
    wait,
    local,
    state,
    repository,
    builds,
    submissions,
    progress: sharedProgress,
    progressPrefix,
    onProgress,
    onEvent,
    skipBundleBuild,
    simulator = false,
    simulatorDevice,
    simulatorAutostart = false,
  } = options;
  if (wait && !local) await ensureNativeHostForBuild(platform, profile, config);
  // Host initialization can write lynxship.json (for example, the generated
  // iOS scheme). Always read it again before resolving the build profile so a
  // first build uses the host that was just created in the same invocation.
  const loadedConfig = wait && !local ? await loadConfig(root) : config;
  const pluginApplication =
    wait && !local
      ? await applyProjectPlugins(root, loadedConfig, { platform, profile })
      : {
          config: loadedConfig,
          report: { configured: 0, plugins: [] },
          applied: [],
          templates: [],
          cloud: [],
          build: [],
          changes: [],
          autolink: [],
        };
  const effectiveConfig = pluginApplication.config;
  if (platform === "android" || platform === "ios")
    await requireAutolinkReady(root, platform);
  const runtime = await inspectRuntimeFingerprint(
    root,
    platform,
    effectiveConfig,
  );
  const resolvedBuildProfile = resolveProfile(effectiveConfig, profile);
  const job = await builds.create({
    projectId: configuredProjectId(effectiveConfig),
    organizationId: "local_org",
    platform,
    profile,
    sourceHash: createHash("sha256").update(root).digest("hex"),
    runtimeVersion: runtime.value,
    runtimeInputs: runtime.inputs,
  });
  ui.info(`Using profile: ${profile} · platform: ${platform}`);
  const ownsProgress = !sharedProgress;
  const progress =
    sharedProgress ??
    ui.progress(`${platform[0]!.toUpperCase()}${platform.slice(1)} build`);
  const prefix = progressPrefix ? `${progressPrefix} · ` : "";
  const reportEvent = (message: string): void => {
    if (onEvent) onEvent(message);
    else progress.event(`${prefix}${message}`);
  };
  const reportProgress = (value?: number, label?: string): void => {
    if (onProgress) onProgress(value, label);
    else progress.update(value, label ? `${prefix}${label}` : undefined);
  };
  try {
    reportProgress(undefined, "Preparing build pipeline…");
    if (wait) {
      if (platform === "android" && !isSupportedAndroidPlatform() && !local)
        assert(
          false,
          "ANDROID_PLATFORM_UNSUPPORTED",
          "Android builds are supported only on Linux, macOS and Windows.",
        );
      const realAndroid =
        platform === "android" &&
        isSupportedAndroidPlatform() &&
        (await hasAndroidHost(root));
      const realIos =
        platform === "ios" &&
        hasIosHost(root, resolveProfile(effectiveConfig, profile));
      if (platform === "ios" && !realIos && !local)
        assert(
          false,
          "IOS_HOST_REQUIRED",
          "A macOS Xcode host is required for a real iOS build. Run `lynxship ios host init --bundle-identifier <id>` or pass --bundle-identifier <id> to build.",
        );
      if (platform === "android" && !realAndroid && !local)
        assert(
          false,
          "ANDROID_HOST_REQUIRED",
          "This project has no Android Gradle host. Run `lynxship android host init --application-id <id>` or pass --application-id <id> to build. `lynxship dev` remains available for Lynx Explorer; `--local` does not create an APK.",
        );
      if (realAndroid) {
        const toolchain = await inspectAndroidToolchain(root);
        assert(
          toolchain.ok,
          "ANDROID_TOOLCHAIN_REQUIRED",
          `Android toolchain is not ready: ${formatAndroidToolchainFailure(toolchain)}`,
        );
        await runRealAndroidBuild(job, {
          root,
          profile: resolvedBuildProfile,
          uploadArtifacts: !skipUpload,
          skipBundleBuild,
          quiet: json,
          onEvent: reportEvent,
          onProgress: reportProgress,
        });
      } else if (realIos) {
        const toolchain = await inspectIosToolchain(
          root,
          resolveProfile(effectiveConfig, profile),
          simulator ? "simulator" : "device",
        );
        assert(
          toolchain.ok,
          "IOS_TOOLCHAIN_REQUIRED",
          `iOS toolchain is not ready: ${formatIosToolchainFailure(toolchain)}`,
        );
        await runRealIosBuild(job, {
          root,
          profile: resolvedBuildProfile,
          simulator,
          simulatorDevice,
          simulatorAutostart,
          uploadArtifacts: !skipUpload,
          skipBundleBuild,
          quiet: json,
          onEvent: reportEvent,
          onProgress: reportProgress,
        });
      } else if (!local && platform === "web") {
        await runRealWebBuild(job, {
          root,
          profile: resolveProfile(effectiveConfig, profile),
          uploadArtifacts: !skipUpload,
          skipBundleBuild,
          quiet: json,
          onEvent: reportEvent,
          onProgress: reportProgress,
        });
      } else if (!local && platform === "harmony") {
        await runRealHarmonyBuild(job, {
          root,
          profile: resolveProfile(effectiveConfig, profile),
          uploadArtifacts: !skipUpload,
          skipBundleBuild,
          quiet: json,
          onEvent: reportEvent,
          onProgress: reportProgress,
        });
      } else if (!local && platform === "desktop") {
        await runRealDesktopBuild(job, {
          root,
          profile: resolveProfile(effectiveConfig, profile),
          uploadArtifacts: !skipUpload,
          allowUnsigned: options.allowUnsigned,
          skipBundleBuild,
          quiet: json,
          onEvent: reportEvent,
          onProgress: reportProgress,
        });
      } else {
        await builds.run(job.id);
      }
    }
    reportProgress(100);
    await saveState(state, repository, builds, submissions);
  } catch (error) {
    await saveState(state, repository, builds, submissions);
    if (error instanceof Error) {
      Object.assign(error, { buildId: job.id });
    }
    throw error;
  } finally {
    if (ownsProgress) progress.stop();
  }
  const result = builds.get(job.id);
  if (showResult) {
    printValue(result, {
      title: `${platform[0]!.toUpperCase()}${platform.slice(1)} build result`,
      rows: [
        { label: "Build ID", value: result.id, valueColor: "purple" },
        { label: "Platform", value: result.platform, valueColor: "blue" },
        { label: "Profile", value: result.profile, valueColor: "text" },
        {
          label: "Status",
          value: result.state,
          valueColor: result.state === "success" ? "green" : "yellow",
        },
      ],
      done:
        result.state === "success"
          ? "Build complete. Run lynxship submit to publish."
          : "Build queued.",
    });
    if (result.state === "success" && result.artifact?.url)
      ui.downloadArtifact(result.artifact.url, result.artifact.expiresAt);
  }
  return result;
}
