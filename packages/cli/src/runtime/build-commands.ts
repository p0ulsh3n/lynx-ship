import { assert, type BuildJob, type Platform } from "@lynxship/contracts";
import {
  loadConfig,
  platformValue,
  resolveProfile,
  type LynxShipConfig,
} from "../config.js";
import {
  ensureNativeHostForBuild,
  initializeBuildProject,
} from "../commands/project.js";
import { executeBuild } from "../commands/build-execution.js";
import { runOtaCommand } from "../commands/ota.js";
import { runSubmit } from "../commands/submit.js";
import { executeRemoteBuild } from "../commands/remote-build.js";
import {
  cancelRemoteBuild,
  ensureRemoteTarget,
  getRemoteBuild,
  listRemoteBuilds,
  retryRemoteBuild,
  type RemoteCliState,
} from "../remote.js";
import { prepareRemoteSource } from "../commands/remote-build.js";
import { loadState, saveState } from "./state.js";
import type { CliRuntime } from "./context.js";

export async function runBuildOrStateCommand(
  context: CliRuntime,
  command: string,
): Promise<void> {
  if (command === "build")
    await initializeBuildProject(context.projectCommandContext);
  const { state, repository, builds, submissions } = await loadState(
    context.root,
  );

  if (command === "rollback" || command === "update") {
    await runOtaCommand(
      {
        root: context.root,
        args: context.args,
        ui: context.ui,
        flag: context.flag,
        printValue: context.printValue,
        requireOperationalConfiguration: (target) =>
          context.requireOperationalConfiguration(target),
        requireR2Configuration: context.requireR2Configuration,
        configuredProjectId: context.configuredProjectId,
        mobilePlatformValue: context.mobilePlatformValue,
        state,
        repository,
        builds,
        submissions,
      },
      command,
    );
    return;
  }

  if (command === "submit") {
    await runSubmit({
      root: context.root,
      args: context.args,
      ui: context.ui,
      flag: context.flag,
      printValue: context.printValue,
      requireOperationalConfiguration: context.requireOperationalConfiguration,
      configuredProjectId: context.configuredProjectId,
      mobilePlatformValue: context.mobilePlatformValue,
      state,
      repository,
      builds,
      submissions,
    });
    return;
  }

  const subcommand =
    context.args[0] && !context.args[0].startsWith("--")
      ? (context.args.shift() ?? "create")
      : "create";
  const platformArgument = context.flag("--platform", "android")!;
  const buildAll = subcommand === "all" || platformArgument === "all";
  const platform = buildAll ? "android" : platformValue(platformArgument);
  const simulator = context.args.includes("--simulator");
  const remote = context.args.includes("--remote");
  const skipUpload = context.args.includes("--no-upload") || simulator;
  assert(
    !remote || !context.args.includes("--local"),
    "CLI_BUILD_FLAGS",
    "--remote and --local are mutually exclusive.",
  );
  assert(
    !remote || !simulator,
    "CLI_BUILD_FLAGS",
    "--remote cannot create a local iOS Simulator app. Use a local macOS build for simulator output.",
  );
  assert(
    !remote || !context.args.includes("--no-upload"),
    "CLI_BUILD_FLAGS",
    "--remote always stores the build artifact on the configured remote worker; remove --no-upload.",
  );
  assert(
    !simulator || platformArgument === "ios",
    "IOS_SIMULATOR_PLATFORM",
    "The --simulator option is only available with --platform ios.",
  );
  const allowUnsigned = context.args.includes("--allow-unsigned");
  assert(
    !allowUnsigned || skipUpload,
    "CLI_UNSIGNED_UPLOAD_BLOCKED",
    "--allow-unsigned is only available with --no-upload and can never upload an unsigned Desktop artifact.",
  );
  await context.requireOperationalConfiguration(platform, {
    requireR2: remote ? false : !skipUpload,
    requireSigning: !remote,
  });

  if (remote && ["list", "status", "cancel", "retry"].includes(subcommand)) {
    const config = await loadConfig(context.root);
    const remoteState = state as RemoteCliState;
    if (subcommand === "list") {
      context.printValue(await listRemoteBuilds(config, remoteState));
      return;
    }
    const id = context.args[0];
    assert(
      id,
      "CLI_BUILD_ID_REQUIRED",
      `A build id is required for ${subcommand}.`,
    );
    const job =
      subcommand === "status"
        ? await getRemoteBuild(config, id)
        : subcommand === "cancel"
          ? await cancelRemoteBuild(config, id)
          : await retryRemoteBuild(config, id);
    if (subcommand !== "status") {
      builds.restore([
        ...builds.list().filter((candidate) => candidate.id !== job.id),
        job,
      ]);
      await saveState(state, repository, builds, submissions);
    }
    context.printValue(job);
    return;
  }

  if (subcommand === "list") {
    context.printValue(builds.list());
    return;
  }
  const id = context.args[0];
  if (subcommand === "status") {
    context.printValue(builds.get(id ?? ""));
    return;
  }
  if (subcommand === "cancel") {
    const job = builds.cancel(id ?? "");
    await saveState(state, repository, builds, submissions);
    context.printValue(job);
    return;
  }
  if (subcommand === "retry") {
    const job = builds.retry(id ?? "");
    await saveState(state, repository, builds, submissions);
    context.printValue(job);
    return;
  }

  assert(
    subcommand === "create" || buildAll,
    "CLI_BUILD_COMMAND",
    `Unknown build command: ${subcommand}`,
  );
  const config = await loadConfig(context.root);
  const profile = context.flag(
    "--profile",
    simulator ? "simulator" : "production",
  )!;
  const simulatorDevice = context.flag("--device") ?? undefined;
  const simulatorAutostart =
    simulator &&
    !context.args.includes("--no-autostart") &&
    (context.args.includes("--autostart") ||
      (!context.json && context.ui.interactive));
  const wait = !context.args.includes("--no-wait");
  const local = context.args.includes("--local");
  const platforms: Platform[] = buildAll
    ? ["android", "ios", "harmony", "web", "desktop"]
    : [platform];

  if (buildAll && wait && !local && !remote) {
    assert(
      process.platform === "darwin",
      "BUILD_ALL_MACOS_REQUIRED",
      "A real all-target build includes iOS and therefore requires macOS locally. Run supported targets individually on Windows/Linux, or use a macOS CI worker for the complete matrix.",
    );
    for (const target of platforms)
      await ensureNativeHostForBuild(
        context.projectCommandContext,
        target,
        profile,
        config,
      );
  }

  if (remote) {
    const loaded = { state, repository, builds, submissions };
    if (buildAll) {
      const source = await prepareRemoteSource(
        context.root,
        config,
        state as RemoteCliState,
      );
      await ensureRemoteTarget(config, state as RemoteCliState);
      const outcomes = await Promise.all(
        platforms.map((target) =>
          executeRemoteBuild({
            root: context.root,
            config,
            state,
            loaded,
            platform: target,
            profile,
            wait,
            source,
            printValue: context.printValue,
            ui: context.ui,
          }),
        ),
      );
      context.printValue({
        status: outcomes.every((job) => job.state === "success")
          ? "success"
          : outcomes.some((job) => ["failed", "timed_out"].includes(job.state))
            ? "failed"
            : "queued",
        builds: outcomes,
      });
    } else {
      await executeRemoteBuild({
        root: context.root,
        config,
        state,
        loaded,
        platform,
        profile,
        wait,
        printValue: context.printValue,
        ui: context.ui,
      });
    }
    return;
  }

  const buildOptions = {
    root: context.root,
    ui: context.ui,
    json: context.json,
    ensureNativeHostForBuild: (
      target: Platform,
      selectedProfile: string,
      selectedConfig: LynxShipConfig,
    ) =>
      ensureNativeHostForBuild(
        context.projectCommandContext,
        target,
        selectedProfile,
        selectedConfig,
      ),
    requireAutolinkReady: context.requireAutolinkReady,
    configuredProjectId: context.configuredProjectId,
    printValue: context.printValue,
    config,
    profile,
    platform,
    skipUpload,
    allowUnsigned,
    wait,
    local,
    simulator,
    simulatorDevice,
    simulatorAutostart,
    state,
    repository,
    builds,
    submissions,
  };

  if (!buildAll) {
    await executeBuild(buildOptions);
    return;
  }

  if (buildAll && wait && !local)
    await context.buildSharedLynxBundle(resolveProfile(config, profile).miso);
  await runAllBuilds(context, {
    ...buildOptions,
    platforms,
  });
}

interface AllBuildOptions {
  root: string;
  ui: CliRuntime["ui"];
  json: boolean;
  ensureNativeHostForBuild: (
    target: Platform,
    selectedProfile: string,
    selectedConfig: LynxShipConfig,
  ) => Promise<void>;
  requireAutolinkReady: CliRuntime["requireAutolinkReady"];
  configuredProjectId: CliRuntime["configuredProjectId"];
  printValue: CliRuntime["printValue"];
  config: LynxShipConfig;
  profile: string;
  platform: Platform;
  skipUpload: boolean;
  allowUnsigned: boolean;
  wait: boolean;
  local: boolean;
  simulator: boolean;
  simulatorDevice?: string;
  simulatorAutostart: boolean;
  state: Awaited<ReturnType<typeof loadState>>["state"];
  repository: Awaited<ReturnType<typeof loadState>>["repository"];
  builds: Awaited<ReturnType<typeof loadState>>["builds"];
  submissions: Awaited<ReturnType<typeof loadState>>["submissions"];
  platforms: Platform[];
}

async function runAllBuilds(
  context: CliRuntime,
  options: AllBuildOptions,
): Promise<void> {
  const progress = options.ui.progress("All Lynx targets build");
  const progressValues: Partial<Record<Platform, number>> = {};
  const progressLabels: Partial<Record<Platform, string>> = {};
  const platformName = (target: Platform): string =>
    target === "android"
      ? "Android"
      : target === "ios"
        ? "iOS"
        : target === "harmony"
          ? "HarmonyOS"
          : target === "web"
            ? "Web"
            : "Desktop";
  const outcomes = await Promise.allSettled(
    options.platforms.map((target) =>
      executeBuild(
        {
          ...options,
          platform: target,
          progress,
          progressPrefix: platformName(target),
          skipBundleBuild: options.wait && !options.local && target !== "web",
          onEvent: (message: string) =>
            progress.event(`${platformName(target)} · ${message}`),
          onProgress: (value?: number, label?: string) => {
            if (value !== undefined) progressValues[target] = value;
            if (label) progressLabels[target] = label;
            const average =
              options.platforms.reduce(
                (total, current) => total + (progressValues[current] ?? 0),
                0,
              ) / options.platforms.length;
            progress.update(
              average,
              `${platformName(target)} · ${progressLabels[target] ?? ""}`,
            );
          },
        },
        false,
      ),
    ),
  );
  progress.update(100, "All Lynx target builds finished");
  progress.stop();

  const summaryBuilds: Array<
    BuildJob | { platform: Platform; state: "failed"; error: string }
  > = outcomes.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    const error = outcome.reason;
    const buildId =
      error && typeof error === "object" && "buildId" in error
        ? String(error.buildId)
        : undefined;
    const job = buildId ? options.builds.jobs.get(buildId) : undefined;
    return (
      job ?? {
        platform: options.platforms[index] ?? "android",
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      }
    );
  });
  const failed = summaryBuilds.some((result) => result.state === "failed");
  context.printValue(
    {
      status: failed
        ? "failed"
        : summaryBuilds.every((result) => result.state === "success")
          ? "success"
          : "queued",
      builds: summaryBuilds,
    },
    {
      title: "Build all result",
      rows: summaryBuilds.map((result) => ({
        label: platformName(result.platform),
        value: `${result.state}${"id" in result ? ` · ${result.id}` : ""}`,
        valueColor:
          result.state === "success"
            ? "green"
            : result.state === "failed"
              ? "red"
              : "yellow",
      })),
      done: failed
        ? "At least one platform build failed. Review its events and retry that platform."
        : "All Lynx target build jobs completed. Submit supported store artifacts separately.",
    },
  );
  for (const result of summaryBuilds)
    if (
      result.state === "success" &&
      "artifact" in result &&
      result.artifact?.url
    )
      options.ui.downloadArtifact(
        result.artifact.url,
        result.artifact.expiresAt,
      );
  if (failed) process.exitCode = 5;
}
