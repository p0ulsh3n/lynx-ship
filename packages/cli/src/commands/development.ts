import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assert, type MobilePlatform } from "@lynxship/contracts";
import {
  packageManagerCommand,
  runProcess,
  runRspeedy,
} from "../process-runner.js";
import { extractDevServerUrl, shouldPrintDevServerQr } from "../dev-qr.js";
import { formatDevToolFailure, inspectLynxDevTool } from "../lynx-devtool.js";
import {
  initializeBuildProject,
  type ProjectCommandContext,
} from "./project.js";
import type { BoxRow, CliUi } from "../ui/index.js";

export interface DevelopmentCommandContext {
  root: string;
  args: readonly string[];
  ui: CliUi;
  json: boolean;
  flag: (name: string, fallback?: string | null) => string | null;
  project: ProjectCommandContext;
  printValue: (
    value: unknown,
    view?: { title: string; rows: BoxRow[]; done: string },
  ) => void;
  mobilePlatformValue: (value: string) => MobilePlatform;
}

export function forwardedToolArgs(values: readonly string[]): string[] {
  const result: string[] = [];
  const valueFlags = new Set([
    "--project-dir",
    "--platform",
    "--profile",
    "--context.json",
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value) continue;
    if (valueFlags.has(value)) {
      index += 1;
      continue;
    }
    if (
      [
        "--quiet",
        "--verbose",
        "--no-color",
        "--non-interactive",
        "--banner",
        "--local",
      ].includes(value)
    )
      continue;
    if (value.startsWith("--project-dir=")) continue;
    result.push(value);
  }
  return result;
}

export async function runRspeedyCommand(
  context: DevelopmentCommandContext,
  subcommand: "dev" | "preview" | "inspect" | "build",
  environment?: NodeJS.ProcessEnv,
): Promise<void> {
  await initializeBuildProject(context.project);
  const forwarded = forwardedToolArgs(context.args);
  context.ui.info(`Running local Rspeedy ${subcommand}…`);
  if (subcommand === "dev") {
    context.ui.info(
      "Lynx Explorer mode: no Android or iOS native host is required. Scan the QR code printed by Rspeedy; source changes reload automatically.",
    );
  }
  let devUrl: string | undefined;
  let devQrPrinted = false;
  let devQrTimer: NodeJS.Timeout | undefined;
  const printDevQr = async (): Promise<void> => {
    if (!devUrl || devQrPrinted || context.json || context.ui.options.quiet)
      return;
    devQrPrinted = true;
    if (devQrTimer) clearTimeout(devQrTimer);
    await context.ui.devServerQr(devUrl);
  };
  await runRspeedy(context.root, subcommand, forwarded, {
    env: environment,
    quiet: context.json,
    onOutput: (line) => {
      context.ui.info(`│ ${line}`);
      if (subcommand !== "dev") return;
      const url = extractDevServerUrl(line);
      if (url && (!devUrl || url.includes("fullscreen=true"))) {
        devUrl = url;
        if (devQrTimer) clearTimeout(devQrTimer);
        devQrTimer = setTimeout(() => {
          void printDevQr();
        }, 500);
      }
      if (devUrl && shouldPrintDevServerQr(line)) void printDevQr();
    },
  });
  context.printValue(
    { status: "success", command: `rspeedy ${subcommand}` },
    {
      title: `Rspeedy ${subcommand}`,
      rows: [
        {
          label: "Command",
          value: `rspeedy ${subcommand}`,
          valueColor: "blue",
        },
      ],
      done: `Rspeedy ${subcommand} completed successfully.`,
    },
  );
}

export async function runAutolinkCodegen(
  context: DevelopmentCommandContext,
): Promise<void> {
  const libraryDirectory = resolve(
    context.root,
    context.flag("--library-dir", ".")!,
  );
  const packageJson = JSON.parse(
    await readFile(join(libraryDirectory, "package.context.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert(
    packageJson.scripts?.codegen,
    "LYNX_CODEGEN_SCRIPT_REQUIRED",
    "No codegen script was found. Add the official lynx-autolink-codegen script to the native library package.",
  );
  const manager = packageManagerCommand(libraryDirectory);
  context.ui.info(
    "Running the project's official Native Module codegen script…",
  );
  await runProcess(manager.command, ["run", "codegen"], {
    cwd: libraryDirectory,
    quiet: context.json,
    onOutput: (line) => context.ui.info(`│ ${line}`),
  });
  context.printValue(
    { status: "success", directory: libraryDirectory },
    {
      title: "Lynx Autolink codegen",
      rows: [{ label: "Library", value: libraryDirectory, valueColor: "blue" }],
      done: "Native Module specifications were generated successfully.",
    },
  );
}

export async function runDevToolDoctor(
  context: DevelopmentCommandContext,
  kind: "devtool" | "trace" | "recorder",
): Promise<void> {
  await initializeBuildProject(context.project);
  const platform = context.mobilePlatformValue(
    context.flag("--platform", "android")!,
  );
  const status = await inspectLynxDevTool(context.root, platform);
  const ready =
    kind === "devtool"
      ? status.ok
      : kind === "trace"
        ? status.traceReady
        : status.recorderReady;
  if (!ready) process.exitCode = 1;
  context.printValue(
    { ...status, requested: kind, ready },
    {
      title: `Lynx ${kind === "devtool" ? "DevTool" : kind[0]!.toUpperCase() + kind.slice(1)} · ${platform}`,
      rows: status.checks.map((item) => ({
        label: item.name,
        value: `${item.status} · ${item.value}${item.fix && item.status !== "pass" ? ` · fix: ${item.fix}` : ""}`,
        valueColor:
          item.status === "pass"
            ? "green"
            : item.status === "warn"
              ? "yellow"
              : "red",
      })),
      done: ready
        ? `${kind} prerequisites are ready. Open Lynx DevTool Desktop and connect the target device by USB.`
        : `Lynx ${kind} prerequisites are incomplete: ${formatDevToolFailure(status) || "review the failed checks"}`,
    },
  );
}
