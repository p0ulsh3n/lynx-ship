import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assert,
  type MobilePlatform,
  type Platform,
} from "@lynxship/contracts";
import {
  platformValue,
  type BuildProfile,
  type LynxShipConfig,
} from "../config.js";
import { loadCredentials } from "../secure-store.js";
import { createCliUi, type BoxRow } from "../ui/index.js";
import { globalLynxShipDirectory } from "../paths.js";
import { prompt } from "../prompt.js";
import { buildLynxBundle } from "../bundle-build.js";
import { requireAutolinkReady } from "../autolink.js";
import { exists, findProjectRoot } from "./project.js";
import { projectDirectoryFlag, readFlag } from "./args.js";

interface View {
  title: string;
  rows: BoxRow[];
  done: string;
}

export function createCliRuntime(rawArgs: string[]) {
  const args = [...rawArgs];
  const ui = createCliUi(rawArgs);
  const json = ui.options.json;
  const root = findProjectRoot(process.cwd(), {
    explicitDirectory: projectDirectoryFlag(rawArgs),
    environmentDirectory: process.env.LYNXSHIP_PROJECT_DIR,
  });
  const flag = (name: string, fallback: string | null = null): string | null =>
    readFlag(args, name, fallback);

  function printValue(value: unknown, view?: View): void {
    if (json) {
      console.log(
        JSON.stringify(typeof value === "string" ? { result: value } : value),
      );
      return;
    }
    if (!ui.interactive || !view) {
      console.log(
        typeof value === "string" ? value : JSON.stringify(value, null, 2),
      );
      return;
    }
    ui.summary(view.title, view.rows);
    ui.done(view.done);
  }

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
    options: { requireR2?: boolean; requireSigning?: boolean } = {},
  ): Promise<void> {
    await requireProjectRoot();
    const status = await readConfigurationStatus();
    if (options.requireR2 !== false)
      assert(
        status.r2,
        "CLI_R2_REQUIRED",
        "Cloudflare R2 must be configured first. Run `lynxship storage configure`.",
      );
    if (platform !== "android" || options.requireSigning === false) return;
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
    if (rawArgs.includes("--remote")) return;
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

  return {
    rawArgs,
    args,
    ui,
    json,
    root,
    flag,
    projectCommandContext,
    commandContext,
    printValue,
    assertInteractivePrompt,
    requireProjectRoot,
    readConfigurationStatus,
    requireOperationalConfiguration,
    requireR2Configuration,
    configuredProjectId,
    mobilePlatformValue,
    renderConfigurationFooter,
    buildSharedLynxBundle,
    initSelfHost,
    requireAutolinkReady,
  };
}

export type CliRuntime = ReturnType<typeof createCliRuntime>;
