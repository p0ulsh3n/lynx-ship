#!/usr/bin/env node

import {
  runAutolinkCodegen,
  runDevToolDoctor,
  runRspeedyCommand,
} from "./commands/development.js";
import { runDevice } from "./commands/device.js";
import { streamNativeLogs } from "./commands/logs.js";

import {
  ensureNativeHostForBuild,
  initializeBuildProject,
  initializeProject,
} from "./commands/project.js";

import { executeBuild } from "./commands/build-execution.js";
import { runDoctor } from "./commands/doctor.js";
import { runOtaCommand } from "./commands/ota.js";
import { runSubmit } from "./commands/submit.js";
import { runConfigurationCommands } from "./commands/configuration.js";

import { helpText } from "./commands/help.js";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  assert,
  type BuildJob,
  type MobilePlatform,
  type Platform,
} from "@lynxship/contracts";
import {
  loadConfig,
  platformValue,
  resolveProfile,
  type BuildProfile,
  type LynxShipConfig,
} from "./config.js";
import { loadCredentials } from "./secure-store.js";
import { createCliUi, type BoxRow } from "./ui/index.js";
import { globalLynxShipDirectory } from "./paths.js";
import { inspectAutolink, requireAutolinkReady } from "./autolink.js";
import { inspectOtaHost } from "./ota-doctor.js";
import { prompt } from "./prompt.js";
import { guidanceForError } from "./guidance.js";
import { buildLynxBundle } from "./bundle-build.js";
import { applyProjectPlugins, inspectProjectPlugins } from "./plugins.js";
import { exists, findProjectRoot } from "./runtime/project.js";
import { projectDirectoryFlag, readFlag } from "./runtime/args.js";
import { loadState, saveState } from "./runtime/state.js";
import { commandTitle, exitCode } from "./commands/metadata.js";

interface View {
  title: string;
  rows: BoxRow[];
  done: string;
}

const rawArgs = process.argv.slice(2);
const args = [...rawArgs];
const ui = createCliUi(rawArgs);
const json = ui.options.json;

const root = findProjectRoot(process.cwd(), {
  explicitDirectory: projectDirectoryFlag(rawArgs),
  environmentDirectory: process.env.LYNXSHIP_PROJECT_DIR,
});

const flag = (name: string, fallback: string | null = null): string | null =>
  readFlag(args, name, fallback);
const projectCommandContext = { root, ui, flag, prompt };
const commandContext = {
  root,
  args,
  ui,
  json,
  flag,
  project: projectCommandContext,
  printValue,
  mobilePlatformValue,
};

async function assertInteractivePrompt(
  label: string,
  fallback: string,
  optionName: string,
): Promise<string> {
  assert(
    ui.interactive,
    "CLI_INTERACTIVE_REQUIRED",
    `Pass ${label.toLowerCase()} with ${optionName} in non-interactive mode.`,
  );
  return prompt(label, fallback);
}

function printValue(value: unknown, view?: View): void {
  if (json) {
    console.log(
      JSON.stringify(typeof value === "string" ? { result: value } : value),
    );
    return;
  }
  if (json || !ui.interactive || !view) {
    console.log(
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );
    return;
  }
  ui.summary(view.title, view.rows);
  ui.done(view.done);
}

async function requireProjectRoot(): Promise<void> {
  assert(
    await exists(join(root, "lynxship.json")),
    "CLI_PROJECT_REQUIRED",
    "Run this command from a LynxShip project directory containing lynxship.json, or run `lynxship init` first.",
  );
}

async function readConfigurationStatus(): Promise<{
  r2: boolean;
  android: boolean;
}> {
  const credentials = await loadCredentials(root);
  const r2Configured =
    (((await exists(join(root, ".lynxship", "r2.json"))) ||
      (await exists(join(globalLynxShipDirectory(), "r2.json")))) &&
      Boolean(credentials.r2)) ||
    Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.R2_BUCKET &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
    );
  const android = credentials.android;
  const androidConfigured =
    Boolean(android?.keystorePath && (await exists(android.keystorePath))) ||
    Boolean(
      process.env.LYNXSHIP_KEYSTORE_PATH &&
      (await exists(process.env.LYNXSHIP_KEYSTORE_PATH)) &&
      process.env.LYNXSHIP_KEY_ALIAS &&
      process.env.LYNXSHIP_KEYSTORE_PASSWORD &&
      process.env.LYNXSHIP_KEY_PASSWORD,
    );
  return { r2: r2Configured, android: androidConfigured };
}

async function requireOperationalConfiguration(
  platform: Platform,
  options: { requireR2?: boolean } = {},
): Promise<void> {
  await requireProjectRoot();
  const status = await readConfigurationStatus();
  if (options.requireR2 !== false)
    assert(
      status.r2,
      "CLI_R2_REQUIRED",
      "Cloudflare R2 must be configured first. Run `lynxship storage configure`.",
    );
  if (platform !== "android") return;
  assert(
    status.android,
    "BUILD_SIGNING_REQUIRED",
    "Android signing must be configured first. Run `lynxship android configure` or provide an existing keystore.",
  );
}

async function requireR2Configuration(): Promise<void> {
  await requireProjectRoot();
  const status = await readConfigurationStatus();
  assert(
    status.r2,
    "CLI_R2_REQUIRED",
    "Cloudflare R2 must be configured first. Run `lynxship storage configure`.",
  );
}

function configuredProjectId(config: LynxShipConfig): string {
  assert(
    typeof config.projectId === "string" && config.projectId.length > 0,
    "CLI_PROJECT_ID_REQUIRED",
    "lynxship.json must contain a generated projectId. Run `lynxship init` for a new project configuration.",
  );
  return config.projectId;
}

function mobilePlatformValue(value: string): MobilePlatform {
  const platform = platformValue(value);
  assert(
    platform === "android" || platform === "ios",
    "PLATFORM_COMMAND_UNSUPPORTED",
    "This command supports only android or ios. Web, HarmonyOS and Desktop use their own build adapters.",
  );
  return platform;
}

async function renderConfigurationFooter(): Promise<void> {
  if (!ui.interactive || ui.options.quiet) return;
  if (rawArgs[0] === "inspect") return;
  const profileIndex = rawArgs.indexOf("--profile");
  const simulatorProfile =
    profileIndex >= 0 && rawArgs[profileIndex + 1] === "simulator";
  if (rawArgs.includes("--simulator") || simulatorProfile) return;
  const status = await readConfigurationStatus();
  const ready = status.r2 && status.android;
  if (ready) return;
  ui.configurationStatus([
    {
      label: "Cloudflare R2",
      value: status.r2 ? "configured" : "required · storage configure",
      valueColor: status.r2 ? "green" : "yellow",
    },
    {
      label: "Android signing",
      value: status.android ? "configured" : "required · android configure",
      valueColor: status.android ? "green" : "yellow",
    },
    {
      label: "Operational CLI",
      value: ready ? "ready" : "blocked until setup is complete",
      valueColor: ready ? "green" : "red",
    },
  ]);
}

async function buildSharedLynxBundle(
  miso: BuildProfile["miso"],
): Promise<void> {
  const progress = ui.progress("Shared Lynx bundle");
  try {
    progress.update(
      undefined,
      "Building the shared Lynx bundle once for native targets…",
    );
    await buildLynxBundle(root, {
      quiet: json,
      onOutput: (message) => progress.event(message),
      miso,
    });
    progress.update(100, "Shared native Lynx bundle ready");
  } finally {
    progress.stop();
  }
}

async function initSelfHost(): Promise<{ status: string; file: string }> {
  const directory = join(root, ".lynxship");
  await mkdir(directory, { recursive: true });
  const file = join(directory, ".env");
  if (await exists(file)) return { status: "unchanged", file };

  const values = {
    POSTGRES_PASSWORD: randomBytes(24).toString("base64url"),
    LYNXSHIP_TOKEN: randomBytes(32).toString("base64url"),
  };
  await writeFile(
    file,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  return { status: "created", file };
}

async function main(): Promise<void> {
  const command = args.shift() ?? "help";
  const wantsHelp =
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    rawArgs.includes("--help") ||
    rawArgs.includes("-h");
  const shouldShowBanner =
    !json &&
    (wantsHelp || rawArgs.length === 0 || rawArgs.includes("--banner"));
  if (shouldShowBanner) ui.banner();

  if (wantsHelp) {
    if (ui.interactive) ui.header("Help");
    printValue(helpText());
    return;
  }

  ui.header(
    commandTitle(
      command === "update" && args[0] === "rollback" ? "rollback" : command,
    ),
  );
  ui.debug(`cwd=${root}`);

  if (command === "init") {
    ui.info("Scanning project structure…");
    const file = join(root, "lynxship.json");
    if (await exists(file)) {
      ui.warn("lynxship.json already exists; leaving the project unchanged");
      printValue(
        { status: "unchanged", file },
        {
          title: "Project",
          rows: [{ label: "Configuration", value: file, valueColor: "muted" }],
          done: "Project already initialized.",
        },
      );
      return;
    }
    await initializeProject(projectCommandContext);
    const initializedConfig = await loadConfig(root);
    ui.success("Created lynxship.json");
    printValue(
      { status: "created", file },
      {
        title: "Initialized",
        rows: [
          {
            label: "Project ID",
            value: initializedConfig.projectId ?? "unassigned",
            valueColor: "purple",
          },
          { label: "Configuration", value: file, valueColor: "muted" },
        ],
        done: "Project initialized. Run lynxship build to get started.",
      },
    );
    return;
  }

  if (command === "plugin") {
    const subcommand = args.shift() ?? "list";
    assert(
      ["list", "doctor", "apply"].includes(subcommand),
      "CLI_PLUGIN_COMMAND",
      "Use \`lynxship plugin list\`, \`lynxship plugin doctor\` or \`lynxship plugin apply\`.",
    );
    await requireProjectRoot();
    const config = await loadConfig(root);
    const report = await inspectProjectPlugins(root, config);
    if (subcommand === "apply") {
      const platform = platformValue(flag("--platform", "android")!);
      const profile = flag("--profile", "production")!;
      const dryRun = args.includes("--dry-run");
      const result = await applyProjectPlugins(root, config, {
        platform,
        profile,
        mode: dryRun ? "plan" : "apply",
      });
      printValue(
        {
          status: dryRun ? "planned" : "applied",
          platform,
          profile,
          plugins: result.applied,
          nativeChanges: result.changes.filter((change) => change.changed)
            .length,
          changes: result.changes,
          templates: result.templates,
          cloud: result.cloud,
          build: result.build,
        },
        {
          title: `LynxShip plugins · ${platform}`,
          rows: [
            {
              label: "Applied",
              value: result.applied.length ? result.applied.join(", ") : "none",
              valueColor: "green",
            },
            {
              label: "Native changes",
              value: String(
                result.changes.filter((change) => change.changed).length,
              ),
              valueColor: "blue",
            },
          ],
          done: dryRun
            ? "No native files were modified; review the planned changes."
            : "Project plugin changes are applied atomically and idempotently.",
        },
      );
      return;
    }
    const invalid = report.plugins.filter(
      (plugin) => plugin.status !== "ready",
    );
    printValue(report, {
      title: `LynxShip plugins · ${subcommand}`,
      rows:
        report.plugins.length > 0
          ? report.plugins.map((plugin) => ({
              label: plugin.name,
              value: `${plugin.status} · ${plugin.capabilities.join(", ") || "no capabilities"} · ${plugin.reason}`,
              valueColor:
                plugin.status === "ready"
                  ? "green"
                  : plugin.status === "missing"
                    ? "red"
                    : "yellow",
            }))
          : [
              {
                label: "Plugins",
                value: "none configured",
                valueColor: "muted",
              },
            ],
      done:
        invalid.length === 0
          ? "All project plugin manifests are valid."
          : "Fix the invalid plugin package before building.",
    });
    if (subcommand === "doctor" && invalid.length > 0) process.exitCode = 1;
    return;
  }

  if (command === "doctor") {
    await runDoctor({
      root,
      args,
      ui,
      flag,
      printValue,
      readConfigurationStatus,
    });
    return;
  }

  if (["dev", "preview", "inspect"].includes(command)) {
    await runRspeedyCommand(
      commandContext,
      command as "dev" | "preview" | "inspect",
    );
    return;
  }

  if (command === "profile") {
    await runRspeedyCommand(commandContext, "build", {
      ...process.env,
      RSPACK_PROFILE: process.env.RSPACK_PROFILE ?? "ALL",
    });
    return;
  }

  if (["devtool", "trace", "recorder"].includes(command)) {
    const subcommand = args.shift() ?? "doctor";
    assert(
      subcommand === "doctor",
      "CLI_DEVTOOL_COMMAND",
      "Use `lynxship devtool doctor`, `lynxship trace doctor` or `lynxship recorder doctor`.",
    );
    await runDevToolDoctor(
      commandContext,
      command as "devtool" | "trace" | "recorder",
    );
    return;
  }

  if (command === "autolink") {
    const subcommand = args.shift() ?? "check";
    assert(
      ["check", "codegen"].includes(subcommand),
      "CLI_AUTOLINK_COMMAND",
      "Use `lynxship autolink check` or `lynxship autolink codegen`",
    );
    if (subcommand === "codegen") {
      await runAutolinkCodegen(commandContext);
      return;
    }
    const platform = mobilePlatformValue(flag("--platform", "android")!);
    const status = (await inspectAutolink(root))[platform];
    printValue(status, {
      title: `Lynx Autolink · ${platform}`,
      rows: [
        {
          label: "Required",
          value: String(status.required),
          valueColor: "blue",
        },
        {
          label: "Ready",
          value: String(status.ready),
          valueColor: status.ready ? "green" : "red",
        },
        {
          label: "Status",
          value: status.reason,
          valueColor: status.ready ? "green" : "yellow",
        },
      ],
      done: status.ready
        ? "Autolink host integration is ready."
        : "Autolink host integration needs attention.",
    });
    return;
  }

  if (command === "ota") {
    assert(
      (args.shift() ?? "doctor") === "doctor",
      "CLI_OTA_COMMAND",
      "Only `lynxship ota doctor` is available",
    );
    const platform = mobilePlatformValue(flag("--platform", "android")!);
    const status = await inspectOtaHost(root, platform);
    printValue(status, {
      title: `OTA host · ${platform}`,
      rows: [
        {
          label: "Native files",
          value: String(status.files.length),
          valueColor: "blue",
        },
        {
          label: "Missing hooks",
          value: status.missing.length ? status.missing.join(", ") : "none",
          valueColor: status.missing.length ? "red" : "green",
        },
      ],
      done:
        status.missing.length === 0
          ? "Native OTA integration looks ready."
          : "Integrate the LynxShip OTA client before using device OTA.",
    });
    return;
  }

  if (command === "run") {
    await requireProjectRoot();
    await runDevice(commandContext);
    return;
  }

  if (command === "logs") {
    await requireProjectRoot();
    await streamNativeLogs(commandContext);
    return;
  }

  if (command === "self-host") {
    assert(
      (args.shift() ?? "init") === "init",
      "CLI_SELF_HOST_COMMAND",
      "Only self-host init is available in this package",
    );
    ui.info("Preparing local self-host credentials…");
    const result = await initSelfHost();
    ui.success(
      result.status === "created"
        ? "Created protected local environment file"
        : "Existing environment file preserved",
    );
    printValue(result, {
      title: "Self-host setup",
      rows: [
        {
          label: "Status",
          value: result.status,
          valueColor: result.status === "created" ? "green" : "yellow",
        },
        { label: "Environment", value: result.file, valueColor: "muted" },
      ],
      done: "Self-host environment is ready.",
    });
    return;
  }
  if (["storage", "ios", "android", "store"].includes(command)) {
    await runConfigurationCommands(
      {
        root,
        args,
        ui,
        flag,
        printValue,
        project: projectCommandContext,
        assertInteractivePrompt,
        initializeBuildProject,
        mobilePlatformValue,
      },
      command,
    );
    return;
  }

  if (command === "build") await initializeBuildProject(projectCommandContext);
  const { state, repository, builds, submissions } = await loadState(root);

  if (command === "rollback" || command === "update") {
    await runOtaCommand(
      {
        root,
        args,
        ui,
        flag,
        printValue,
        requireOperationalConfiguration: (target) =>
          requireOperationalConfiguration(target),
        requireR2Configuration,
        configuredProjectId,
        mobilePlatformValue,
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
      root,
      args,
      ui,
      flag,
      printValue,
      requireOperationalConfiguration,
      configuredProjectId,
      mobilePlatformValue,
      state,
      repository,
      builds,
      submissions,
    });
    return;
  }

  const subcommand =
    args[0] && !args[0].startsWith("--") ? args.shift() : "create";
  const platformArgument = flag("--platform", "android")!;
  const buildAll = subcommand === "all" || platformArgument === "all";
  const platform = buildAll ? "android" : platformValue(platformArgument);
  const simulator = args.includes("--simulator");
  const skipUpload = args.includes("--no-upload") || simulator;
  assert(
    !simulator || platformArgument === "ios",
    "IOS_SIMULATOR_PLATFORM",
    "The --simulator option is only available with --platform ios.",
  );
  const allowUnsigned = args.includes("--allow-unsigned");
  assert(
    !allowUnsigned || skipUpload,
    "CLI_UNSIGNED_UPLOAD_BLOCKED",
    "--allow-unsigned is only available with --no-upload and can never upload an unsigned Desktop artifact.",
  );
  await requireOperationalConfiguration(platform, { requireR2: !skipUpload });
  if (subcommand === "list") {
    printValue(builds.list());
    return;
  }
  const id = args[0];
  if (subcommand === "status") {
    printValue(builds.get(id ?? ""));
    return;
  }
  if (subcommand === "cancel") {
    const job = builds.cancel(id ?? "");
    await saveState(state, repository, builds, submissions);
    printValue(job);
    return;
  }
  if (subcommand === "retry") {
    const job = builds.retry(id ?? "");
    await saveState(state, repository, builds, submissions);
    printValue(job);
    return;
  }

  assert(
    subcommand === "create" || buildAll,
    "CLI_BUILD_COMMAND",
    `Unknown build command: ${subcommand}`,
  );
  const config = await loadConfig(root);
  const profile = flag("--profile", simulator ? "simulator" : "production")!;
  const simulatorDevice = flag("--device") ?? undefined;
  const simulatorAutostart =
    simulator &&
    !args.includes("--no-autostart") &&
    (args.includes("--autostart") || (!json && ui.interactive));
  const wait = !args.includes("--no-wait");
  const local = args.includes("--local");
  const platforms: Platform[] = buildAll
    ? ["android", "ios", "harmony", "web", "desktop"]
    : [platform];

  if (buildAll && wait && !local) {
    assert(
      process.platform === "darwin",
      "BUILD_ALL_MACOS_REQUIRED",
      "A real all-target build includes iOS and therefore requires macOS locally. Run supported targets individually on Windows/Linux, or use a macOS CI worker for the complete matrix.",
    );
    for (const target of platforms)
      await ensureNativeHostForBuild(
        projectCommandContext,
        target,
        profile,
        config,
      );
  }

  if (!buildAll) {
    await executeBuild({
      root,
      ui,
      json,
      ensureNativeHostForBuild: (target, selectedProfile, selectedConfig) =>
        ensureNativeHostForBuild(
          projectCommandContext,
          target,
          selectedProfile,
          selectedConfig,
        ),
      requireAutolinkReady,
      configuredProjectId,
      printValue,
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
    });
    return;
  }

  if (buildAll && wait && !local)
    await buildSharedLynxBundle(resolveProfile(config, profile).miso);

  const progress = ui.progress("All Lynx targets build");
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
    platforms.map((target) =>
      executeBuild(
        {
          root,
          ui,
          json,
          ensureNativeHostForBuild: (target, selectedProfile, selectedConfig) =>
            ensureNativeHostForBuild(
              projectCommandContext,
              target,
              selectedProfile,
              selectedConfig,
            ),
          requireAutolinkReady,
          configuredProjectId,
          printValue,
          config,
          profile,
          platform: target,
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
          progress,
          progressPrefix: platformName(target),
          skipBundleBuild: wait && !local && target !== "web",
          onEvent: (message) =>
            progress.event(`${platformName(target)} · ${message}`),
          onProgress: (value, label) => {
            if (value !== undefined) progressValues[target] = value;
            if (label) progressLabels[target] = label;
            const average =
              platforms.reduce(
                (total, current) => total + (progressValues[current] ?? 0),
                0,
              ) / platforms.length;
            progress.update(
              average,
              `${platformName(target)} · ${progressLabels[target]}`,
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
    const job = buildId ? builds.jobs.get(buildId) : undefined;
    return (
      job ?? {
        platform: platforms[index] ?? "android",
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      }
    );
  });
  const failed = summaryBuilds.some((result) => result.state === "failed");
  printValue(
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
      ui.downloadArtifact(result.artifact.url, result.artifact.expiresAt);
  if (failed) process.exitCode = 5;
}

void main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    const code = (error as { code?: string }).code ?? "CLI_ERROR";
    const nextSteps = guidanceForError(error, { args: rawArgs });
    if (json) {
      console.log(
        JSON.stringify({
          error: message,
          code,
          ...(nextSteps.commands.length > 0
            ? {
                nextSteps: nextSteps.commands,
                ...(nextSteps.note ? { note: nextSteps.note } : {}),
                ...(nextSteps.environment
                  ? { environment: nextSteps.environment }
                  : {}),
              }
            : {}),
        }),
      );
    } else {
      ui.error(message);
      ui.nextSteps(nextSteps);
    }
    process.exitCode = exitCode(error);
  })
  .finally(async () => {
    try {
      await renderConfigurationFooter();
    } catch {
      // Configuration status must never hide the original command result.
    }
  });
