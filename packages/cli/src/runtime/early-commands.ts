import { join } from "node:path";
import { assert } from "@lynxship/contracts";
import {
  initializeBuildProject,
  initializeProject,
} from "../commands/project.js";
import { runDoctor } from "../commands/doctor.js";
import {
  runRspeedyCommand,
  runDevToolDoctor,
} from "../commands/development.js";
import { runAutolinkCodegen } from "../commands/development.js";
import { runDevice } from "../commands/device.js";
import { streamNativeLogs } from "../commands/logs.js";
import { runConfigurationCommands } from "../commands/configuration.js";
import { inspectAutolink } from "../autolink.js";
import { inspectOtaHost } from "../ota-doctor.js";
import { inspectProjectPlugins, applyProjectPlugins } from "../plugins.js";
import { inspectEcosystem } from "../ecosystem.js";
import { runI18nCommand } from "../commands/i18n.js";
import { loadConfig } from "../config.js";
import { exists } from "./project.js";
import { commandTitle } from "../commands/metadata.js";
import type { CliRuntime } from "./context.js";

export async function runEarlyCommand(
  context: CliRuntime,
  command: string,
): Promise<boolean> {
  const { args, root, ui, flag, projectCommandContext, printValue } = context;

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
      return true;
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
    return true;
  }

  if (command === "plugin") {
    const subcommand = args.shift() ?? "list";
    assert(
      ["list", "doctor", "apply"].includes(subcommand),
      "CLI_PLUGIN_COMMAND",
      "Use `lynxship plugin list`, `lynxship plugin doctor` or `lynxship plugin apply`.",
    );
    await context.requireProjectRoot();
    const config = await loadConfig(root);
    const report = await inspectProjectPlugins(root, config);
    if (subcommand === "apply") {
      const platform = context.mobilePlatformValue(
        flag("--platform", "android")!,
      );
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
      return true;
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
    return true;
  }

  if (command === "ecosystem") {
    const packages = await inspectEcosystem(root);
    printValue(
      { packages },
      {
        title: "LynxShip ecosystem",
        rows: packages.map((item) => ({
          label: item.name,
          value: item.installed
            ? `installed ${item.version}`
            : "available · not installed",
          valueColor: item.installed ? "green" : "muted",
        })),
        done: "Ecosystem package status inspected without changing the project.",
      },
    );
    return true;
  }

  if (command === "i18n") {
    await context.requireProjectRoot();
    await runI18nCommand({
      root,
      args,
      ui,
      flag,
      printValue,
    });
    return true;
  }

  if (command === "doctor") {
    await runDoctor({
      root,
      args,
      ui,
      flag,
      printValue,
      readConfigurationStatus: context.readConfigurationStatus,
    });
    return true;
  }

  if (["dev", "preview", "inspect"].includes(command)) {
    await runRspeedyCommand(
      context.commandContext,
      command as "dev" | "preview" | "inspect",
    );
    return true;
  }

  if (command === "profile") {
    await runRspeedyCommand(context.commandContext, "build", {
      ...process.env,
      RSPACK_PROFILE: process.env.RSPACK_PROFILE ?? "ALL",
    });
    return true;
  }

  if (["devtool", "trace", "recorder"].includes(command)) {
    const subcommand = args.shift() ?? "doctor";
    assert(
      subcommand === "doctor",
      "CLI_DEVTOOL_COMMAND",
      "Use `lynxship devtool doctor`, `lynxship trace doctor` or `lynxship recorder doctor`.",
    );
    await runDevToolDoctor(
      context.commandContext,
      command as "devtool" | "trace" | "recorder",
    );
    return true;
  }

  if (command === "autolink") {
    const subcommand = args.shift() ?? "check";
    assert(
      ["check", "codegen"].includes(subcommand),
      "CLI_AUTOLINK_COMMAND",
      "Use `lynxship autolink check` or `lynxship autolink codegen`",
    );
    if (subcommand === "codegen") {
      await runAutolinkCodegen(context.commandContext);
      return true;
    }
    const platform = context.mobilePlatformValue(
      flag("--platform", "android")!,
    );
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
    return true;
  }

  if (command === "ota") {
    assert(
      (args.shift() ?? "doctor") === "doctor",
      "CLI_OTA_COMMAND",
      "Only `lynxship ota doctor` is available",
    );
    const platform = context.mobilePlatformValue(
      flag("--platform", "android")!,
    );
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
    return true;
  }

  if (command === "run") {
    await context.requireProjectRoot();
    await runDevice(context.commandContext);
    return true;
  }
  if (command === "logs") {
    await context.requireProjectRoot();
    await streamNativeLogs(context.commandContext);
    return true;
  }
  if (command === "self-host") {
    assert(
      (args.shift() ?? "init") === "init",
      "CLI_SELF_HOST_COMMAND",
      "Only self-host init is available in this package",
    );
    ui.info("Preparing local self-host credentials…");
    const result = await context.initSelfHost();
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
    return true;
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
        assertInteractivePrompt: context.assertInteractivePrompt,
        initializeBuildProject,
        mobilePlatformValue: context.mobilePlatformValue,
      },
      command,
    );
    return true;
  }

  return false;
}

export function commandHeader(
  command: string,
  args: readonly string[],
): string {
  return commandTitle(
    command === "update" && args[0] === "rollback" ? "rollback" : command,
  );
}
