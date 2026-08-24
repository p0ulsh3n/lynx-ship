#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { BuildOrchestrator } from "@lynxship/build-orchestrator";
import { JsonRepository } from "@lynxship/db";
import {
  assert,
  createId,
  sha256,
  type BuildJob,
  type Platform,
  type SubmissionJob,
} from "@lynxship/contracts";
import {
  createSigningKey,
  signManifest,
  type SigningKey,
} from "@lynxship/signing";
import {
  AppStoreConnectApiProvider,
  GooglePlayApiProvider,
  SubmissionService,
} from "@lynxship/submit";
import { DEFAULT_CONFIG, loadConfig, platformValue } from "./config.js";
import { hasAndroidHost, runRealAndroidBuild } from "./android-build.js";
import { hasIosHost, runRealIosBuild } from "./ios-build.js";
import {
  configureAndroid,
  configureAppStoreConnect,
  configureGooglePlay,
  configureR2,
} from "./configure.js";
import {
  fetchOtaPublicKey,
  publishOtaRelease,
  submitRealArtifact,
  type RemoteCliState,
} from "./remote.js";
import { uploadR2Artifact } from "./r2.js";
import {
  credentialStorageDescription,
  loadCredentials,
} from "./secure-store.js";
import { createCliUi, type BoxRow } from "./ui/index.js";
import { globalLynxShipDirectory } from "./paths.js";
import { inspectAutolink, requireAutolinkReady } from "./autolink.js";
import {
  assertCompatibleBinaryBuild,
  inspectRuntimeFingerprint,
} from "./runtime-fingerprint.js";
import { inspectOtaHost } from "./ota-doctor.js";
import { otaAssetName, otaAssetPaths } from "./ota-assets.js";
import {
  commandExists,
  packageManagerCommand,
  runProcess,
  runRspeedy,
} from "./process-runner.js";

interface CliRelease {
  id: string;
  manifest: {
    protocolVersion: number;
    projectId: string;
    channel: string;
    platform: Platform;
    runtimeVersion: string;
    sequence: number;
    keyId: string;
    assets: Array<{ path: string; hash: string; size: number; url?: string }>;
  };
  signature: string;
  message: string;
  createdAt: string;
}

interface CliState extends RemoteCliState {
  builds: BuildJob[];
  submissions: SubmissionJob[];
  releases: CliRelease[];
  signingKey: SigningKey | null;
}

interface View {
  title: string;
  rows: BoxRow[];
  done: string;
}

const rawArgs = process.argv.slice(2);
const args = [...rawArgs];
const ui = createCliUi(rawArgs);
const json = ui.options.json;

function requestedProjectDirectory(): string | undefined {
  const index = rawArgs.indexOf("--project-dir");
  if (index >= 0) return rawArgs[index + 1];
  const inline = rawArgs.find((value) => value.startsWith("--project-dir="));
  return inline?.slice("--project-dir=".length);
}

function findProjectRoot(start: string): string {
  const explicit =
    requestedProjectDirectory() ?? process.env.LYNXSHIP_PROJECT_DIR;
  if (explicit) return resolve(explicit);

  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "lynxship.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

const root = findProjectRoot(process.cwd());

function flag(name: string, fallback: string | null = null): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? "true") : fallback;
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

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function findLockfile(rootDirectory: string): Promise<string | null> {
  let current = resolve(rootDirectory);
  while (true) {
    for (const file of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
      if (await exists(join(current, file))) return join(current, file);
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
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
): Promise<void> {
  await requireProjectRoot();
  const status = await readConfigurationStatus();
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

async function renderConfigurationFooter(): Promise<void> {
  if (!ui.interactive || ui.options.quiet) return;
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

async function loadState(): Promise<{
  state: CliState;
  repository: JsonRepository<CliState>;
  builds: BuildOrchestrator;
  submissions: SubmissionService;
}> {
  const repository = new JsonRepository<CliState>(
    join(root, ".lynxship", "state.json"),
    {
      builds: [],
      submissions: [],
      releases: [],
      signingKey: null,
    },
  );
  const state = await repository.read();
  state.builds ??= [];
  state.submissions ??= [];
  state.releases ??= [];
  state.signingKey ??= createSigningKey();

  const builds = new BuildOrchestrator();
  for (const job of state.builds) builds.jobs.set(job.id, job);
  const submissions = new SubmissionService();
  for (const job of state.submissions) submissions.jobs.set(job.id, job);
  return { state, repository, builds, submissions };
}

async function saveState(
  state: CliState,
  repository: JsonRepository<CliState>,
  builds: BuildOrchestrator,
  submissions: SubmissionService,
): Promise<void> {
  state.builds = builds.list();
  state.submissions = submissions.list();
  await repository.write(state);
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

function commandTitle(command: string): string {
  return (
    {
      init: "Initialize project",
      doctor: "Environment doctor",
      dev: "Rspeedy development",
      preview: "Rspeedy preview",
      inspect: "Rspeedy inspection",
      profile: "Rspeedy profiling",
      autolink: "Lynx Autolink",
      run: "Run on device",
      logs: "Native logs",
      ota: "OTA diagnostics",
      build: "Cloud Build",
      submit: "Store Submission",
      update: "OTA Update",
      "self-host": "Self-host setup",
      storage: "Cloudflare R2 setup",
      android: "Android signing setup",
      store: "App store submission setup",
    }[command] ?? command
  );
}

function helpText(): string {
  return `lynxship <command> [options]

Commands:
  init                    Initialize or link a LynxShip project
  doctor                  Check the local toolchain and project
  dev                     Run the project's Rspeedy development server
  preview                 Preview the production Lynx bundle locally
  inspect                 Inspect Rspeedy/Rspack configuration
  profile                 Build with Rspack profiling enabled
  autolink check          Check Lynx native-library Autolink wiring
  autolink codegen        Run the project's Native Module codegen script
  ota doctor              Check native OTA host integration
  run                     Install an artifact on an Android/iOS target
  logs                    Stream Android/iOS native logs
  build                   Create a local/cloud build job
  submit                  Submit the latest successful build
  update                  Upload and publish a signed OTA update
  self-host init          Generate local self-host credentials
  storage configure       Configure Cloudflare R2 and encrypted R2 credentials
  android configure       Configure or generate encrypted Android signing credentials
  store configure         Configure Google Play or App Store Connect submission

Update options:
  --bundle <path[,path]>  Lynx bundle/assets to publish (default: discover dist/*.lynx.bundle)
  --local                 Create a local contract-only update for tests
  --policy-approval-id    Required for an iOS OTA release

Global options:
  --json                  Emit one stable JSON result/error object
  --quiet                 Print only the final machine-relevant result
  --verbose               Include extra operational context
  --no-color              Disable ANSI colors
  --non-interactive       Never prompt; fail on missing inputs
  --banner                Show the Braille LynxShip logo in a TTY
  --project-dir <path>    Use a LynxShip project from any working directory
  --simulator             Install an iOS .app on a simulator with simctl
  doctor --platform <p>   Check Autolink for android or ios (default: android)
  --local                 Use the mock submission provider for local tests only

Node support: Node 22/24 LTS or Node 26 Current. Use Node 24 LTS for production.`;
}

async function looksLikeLynxProject(): Promise<boolean> {
  const configFiles = [
    "lynx.config.ts",
    "lynx.config.js",
    "lynx.config.mjs",
    "lynx.config.cjs",
  ];
  if (await Promise.any(configFiles.map((file) => exists(join(root, file)))))
    return true;

  try {
    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
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
      Object.keys(dependencies).some((name) => name.startsWith("@lynx-js/")) ||
      Object.values(packageJson.scripts ?? {}).some((script) =>
        script.includes("rspeedy"),
      )
    );
  } catch {
    return false;
  }
}

async function initializeProject(): Promise<string> {
  const file = join(root, "lynxship.json");
  if (await exists(file)) return file;
  await mkdir(join(root, ".lynxship"), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      { ...DEFAULT_CONFIG, projectId: flag("--project-id", "local_project") },
      null,
      2,
    )}\n`,
  );
  return file;
}

async function initializeBuildProject(): Promise<void> {
  if (await exists(join(root, "lynxship.json"))) return;
  assert(
    await looksLikeLynxProject(),
    "CLI_PROJECT_REQUIRED",
    "No LynxJS project was detected. Run this command from the project directory or provide `--project-dir`.",
  );
  ui.info("No lynxship.json found. Running lynxship init automatically…");
  await initializeProject();
  ui.success("Created lynxship.json");
}

function forwardedToolArgs(values: string[]): string[] {
  const result: string[] = [];
  const valueFlags = new Set([
    "--project-dir",
    "--platform",
    "--profile",
    "--json",
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

async function runRspeedyCommand(
  subcommand: "dev" | "preview" | "inspect" | "build",
  environment?: NodeJS.ProcessEnv,
): Promise<void> {
  await initializeBuildProject();
  const forwarded = forwardedToolArgs(args);
  ui.info(`Running local Rspeedy ${subcommand}…`);
  await runRspeedy(root, subcommand, forwarded, {
    env: environment,
    quiet: json,
    onOutput: (line) => ui.info(`│ ${line}`),
  });
  printValue(
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

async function runAutolinkCodegen(): Promise<void> {
  const libraryDirectory = resolve(root, flag("--library-dir", ".")!);
  const packageJson = JSON.parse(
    await readFile(join(libraryDirectory, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert(
    packageJson.scripts?.codegen,
    "LYNX_CODEGEN_SCRIPT_REQUIRED",
    "No codegen script was found. Add the official lynx-autolink-codegen script to the native library package.",
  );
  const manager = packageManagerCommand(libraryDirectory);
  ui.info("Running the project's official Native Module codegen script…");
  await runProcess(manager.command, ["run", "codegen"], {
    cwd: libraryDirectory,
    quiet: json,
    onOutput: (line) => ui.info(`│ ${line}`),
  });
  printValue(
    { status: "success", directory: libraryDirectory },
    {
      title: "Lynx Autolink codegen",
      rows: [{ label: "Library", value: libraryDirectory, valueColor: "blue" }],
      done: "Native Module specifications were generated successfully.",
    },
  );
}

async function runDevice(): Promise<void> {
  const platform = platformValue(flag("--platform", "android")!);
  const artifact = flag("--artifact");
  const artifactPath = artifact
    ? resolve(root, artifact)
    : (await loadState()).builds
        .list()
        .filter((job) => job.platform === platform && job.state === "success")
        .at(-1)?.artifact?.path;
  assert(
    artifactPath,
    "DEVICE_ARTIFACT_REQUIRED",
    "Pass --artifact or create a successful build first",
  );
  if (platform === "android") {
    assert(
      commandExists("adb"),
      "ANDROID_ADB_REQUIRED",
      "adb was not found in PATH",
    );
    const device = flag("--device");
    const argsForAdb = device
      ? ["-s", device, "install", "-r", artifactPath]
      : ["install", "-r", artifactPath];
    await runProcess("adb", argsForAdb, {
      cwd: root,
      quiet: json,
      onOutput: (line) => ui.info(`│ ${line}`),
    });
  } else {
    assert(
      process.platform === "darwin",
      "IOS_MACOS_REQUIRED",
      "iOS device/simulator commands require macOS",
    );
    assert(
      commandExists("xcrun"),
      "IOS_XCRUN_REQUIRED",
      "xcrun was not found in PATH",
    );
    const device = flag("--device", "booted")!;
    const simulator = args.includes("--simulator");
    if (simulator || artifactPath.endsWith(".app")) {
      await runProcess("xcrun", ["simctl", "install", device, artifactPath], {
        cwd: root,
        quiet: json,
        onOutput: (line) => ui.info(`│ ${line}`),
      });
    } else {
      assert(
        device !== "booted",
        "IOS_DEVICE_REQUIRED",
        "A physical iOS install requires --device <device-identifier>; use --simulator for a booted simulator.",
      );
      await runProcess(
        "xcrun",
        [
          "devicectl",
          "device",
          "install",
          "app",
          "--device",
          device,
          artifactPath,
        ],
        {
          cwd: root,
          quiet: json,
          onOutput: (line) => ui.info(`│ ${line}`),
        },
      );
    }
  }
  printValue(
    { status: "installed", platform, artifact: artifactPath },
    {
      title: "Device install",
      rows: [{ label: "Artifact", value: artifactPath, valueColor: "green" }],
      done: "Artifact installed on the selected target.",
    },
  );
}

async function streamNativeLogs(): Promise<void> {
  const platform = platformValue(flag("--platform", "android")!);
  const device = flag(
    "--device",
    platform === "android" ? undefined : "booted",
  );
  if (platform === "android") {
    assert(
      commandExists("adb"),
      "ANDROID_ADB_REQUIRED",
      "adb was not found in PATH",
    );
    await runProcess("adb", device ? ["-s", device, "logcat"] : ["logcat"], {
      cwd: root,
      quiet: json,
      onOutput: (line) => ui.info(`│ ${line}`),
    });
  } else {
    assert(
      process.platform === "darwin",
      "IOS_MACOS_REQUIRED",
      "iOS logs require macOS",
    );
    assert(
      commandExists("xcrun"),
      "IOS_XCRUN_REQUIRED",
      "xcrun was not found in PATH",
    );
    assert(
      device !== "booted",
      "IOS_DEVICE_LOGS_UNSUPPORTED",
      "Use --device <simulator-identifier> for iOS simulator logs.",
    );
    await runProcess(
      "xcrun",
      [
        "simctl",
        "spawn",
        device ?? "booted",
        "log",
        "stream",
        "--style",
        "compact",
        "--level",
        "debug",
      ],
      { cwd: root, quiet: json, onOutput: (line) => ui.info(`│ ${line}`) },
    );
  }
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

  ui.header(commandTitle(command));
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
    await initializeProject();
    ui.success("Created lynxship.json");
    printValue(
      { status: "created", file },
      {
        title: "Initialized",
        rows: [
          {
            label: "Project ID",
            value: flag("--project-id", "local_project")!,
            valueColor: "purple",
          },
          { label: "Configuration", value: file, valueColor: "muted" },
        ],
        done: "Project initialized. Run lynxship build to get started.",
      },
    );
    return;
  }

  if (command === "doctor") {
    const config = await loadConfig(root);
    const configuration = await readConfigurationStatus();
    const doctorPlatform = platformValue(flag("--platform", "android")!);
    const autolink = await inspectAutolink(root);
    const autolinkForPlatform = autolink[doctorPlatform];
    const lockfile = await findLockfile(root);
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    const checks = [
      {
        name: "node",
        ok: nodeMajor >= 22 && nodeMajor % 2 === 0,
        value:
          nodeMajor >= 22 && nodeMajor % 2 === 0
            ? process.version
            : `${process.version} · fix: use Node 24 LTS`,
      },
      {
        name: "package-manager-lockfile",
        ok: Boolean(lockfile),
        value: lockfile ?? "missing · fix: npm install or pnpm install",
      },
      {
        name: "lynxship.json",
        ok: await exists(join(root, "lynxship.json")),
        value: config.projectId ? "found" : "missing · fix: lynxship init",
      },
      {
        name: "cloudflare-r2",
        ok: configuration.r2,
        value: configuration.r2
          ? "configured"
          : "run lynxship storage configure",
      },
      {
        name: doctorPlatform === "android" ? "android-signing" : "ios-host",
        ok:
          doctorPlatform === "android"
            ? configuration.android
            : process.platform === "darwin" && hasIosHost(root),
        value:
          doctorPlatform === "android"
            ? configuration.android
              ? "configured"
              : "run lynxship android configure"
            : process.platform === "darwin" && hasIosHost(root)
              ? "Xcode host found"
              : "missing · fix: use macOS with Xcode",
      },
      {
        name: `lynx-autolink-${doctorPlatform}`,
        ok: autolinkForPlatform.ready,
        value: autolinkForPlatform.ready
          ? autolinkForPlatform.reason
          : `${autolinkForPlatform.reason} · fix: install the native plugin, then run autolink codegen`,
      },
    ];
    const result = { ok: checks.every((check) => check.ok), checks };
    if (!result.ok) ui.warn("One or more environment checks need attention");
    printValue(result, {
      title: "Doctor result",
      rows: checks.map((check) => ({
        label: check.name,
        value: `${check.ok ? "pass" : "fail"} · ${check.value}`,
        valueColor: check.ok ? "green" : "red",
      })),
      done: result.ok
        ? "Environment looks ready."
        : "Fix the failed checks before building.",
    });
    return;
  }

  if (["dev", "preview", "inspect"].includes(command)) {
    await runRspeedyCommand(command as "dev" | "preview" | "inspect");
    return;
  }

  if (command === "profile") {
    await runRspeedyCommand("build", {
      ...process.env,
      RSPACK_PROFILE: process.env.RSPACK_PROFILE ?? "ALL",
    });
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
      await runAutolinkCodegen();
      return;
    }
    const platform = platformValue(flag("--platform", "android")!);
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
    const platform = platformValue(flag("--platform", "android")!);
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
    await runDevice();
    return;
  }

  if (command === "logs") {
    await requireProjectRoot();
    await streamNativeLogs();
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

  if (command === "storage") {
    assert(
      ui.interactive,
      "CLI_INTERACTIVE_REQUIRED",
      "Run `lynxship storage configure` in an interactive terminal",
    );
    assert(
      (args.shift() ?? "configure") === "configure",
      "CLI_STORAGE_COMMAND",
      "Only storage configure is available",
    );
    ui.info("Configuring Cloudflare R2. Secret fields will stay invisible…");
    const config = await configureR2(root);
    ui.success(`R2 bucket verified: ${config.bucket}`);
    printValue(
      {
        status: "configured",
        provider: "cloudflare-r2",
        bucket: config.bucket,
      },
      {
        title: "Cloudflare R2",
        rows: [
          { label: "Provider", value: "Cloudflare R2", valueColor: "orange" },
          { label: "Bucket", value: config.bucket, valueColor: "blue" },
          {
            label: "Credentials",
            value: credentialStorageDescription(),
            valueColor: "green",
          },
        ],
        done: "R2 is ready for signed build artifacts.",
      },
    );
    return;
  }

  if (command === "android") {
    assert(
      ui.interactive,
      "CLI_INTERACTIVE_REQUIRED",
      "Run `lynxship android configure` in an interactive terminal",
    );
    assert(
      (args.shift() ?? "configure") === "configure",
      "CLI_ANDROID_COMMAND",
      "Only android configure is available",
    );
    ui.info("Configuring Android signing. Secret fields will stay invisible…");
    const result = await configureAndroid(root);
    ui.success(
      result.generated
        ? `Android keystore generated: ${result.keystorePath}`
        : `Android signing credentials saved in ${credentialStorageDescription()}`,
    );
    printValue(
      { status: "configured", provider: "android-keystore" },
      {
        title: "Android signing",
        rows: [
          { label: "Keystore", value: "Configured", valueColor: "green" },
          {
            label: "Storage",
            value: credentialStorageDescription(),
            valueColor: "green",
          },
        ],
        done: "Android signing is ready for the next build.",
      },
    );
    return;
  }

  if (command === "store") {
    assert(
      ui.interactive,
      "CLI_INTERACTIVE_REQUIRED",
      "Run store configure in an interactive terminal",
    );
    assert(
      (args.shift() ?? "configure") === "configure",
      "CLI_STORE_COMMAND",
      "Only store configure is available",
    );
    const platform = platformValue(flag("--platform", "android")!);
    ui.info(
      platform === "android"
        ? "Configuring Google Play submission. Secret fields will stay invisible…"
        : "Configuring App Store Connect submission. Private key contents stay protected…",
    );
    if (platform === "android") await configureGooglePlay(root);
    else await configureAppStoreConnect(root);
    ui.success(
      platform === "android"
        ? "Google Play submission credentials saved securely"
        : "App Store Connect submission credentials saved securely",
    );
    printValue(
      {
        status: "configured",
        provider: platform === "android" ? "google-play" : "app-store-connect",
        storage: credentialStorageDescription(),
      },
      {
        title:
          platform === "android"
            ? "Google Play submission"
            : "App Store Connect submission",
        rows: [
          {
            label: "Provider",
            value: platform === "android" ? "Google Play" : "App Store Connect",
            valueColor: "blue",
          },
          {
            label: "Credentials",
            value: credentialStorageDescription(),
            valueColor: "green",
          },
        ],
        done: "Store submission is ready for the next build.",
      },
    );
    return;
  }

  if (command === "build") await initializeBuildProject();
  const { state, repository, builds, submissions } = await loadState();

  if (command === "submit") {
    const config = await loadConfig(root);
    const platform = platformValue(flag("--platform", "android")!);
    await requireOperationalConfiguration(platform);
    const credentials = await loadCredentials(root);
    const localMode =
      args.includes("--local") || process.env.LYNXSHIP_SUBMIT_MODE === "mock";
    const storeConfigured =
      platform === "android"
        ? Boolean(credentials.googlePlay)
        : Boolean(credentials.appStoreConnect);
    assert(
      localMode || storeConfigured,
      "STORE_SUBMISSION_REQUIRED",
      platform === "android"
        ? "Google Play is not configured. Run store configure --platform android."
        : "App Store Connect is not configured. Run store configure --platform ios.",
    );
    const candidate = builds
      .list()
      .filter((job) => job.platform === platform && job.state === "success")
      .at(-1);
    assert(candidate, "BUILD_REQUIRED", "A successful build is required");
    assert(
      localMode || candidate.artifact?.path,
      "STORE_ARTIFACT_REQUIRED",
      "A local signed artifact path is required for store submission",
    );
    const latest = args.includes("--latest");
    const spinner = ui.spinner("Submitting artifact…");
    try {
      const controlPlaneSubmission = candidate.artifact?.path
        ? await submitRealArtifact(config, state, candidate, latest)
        : await submissions.submit({
            projectId: config.projectId ?? "local_project",
            organizationId: "local_org",
            platform,
            artifact: candidate.artifact ?? { hash: `local-${candidate.id}` },
            latest,
            buildId: latest ? null : candidate.id,
          });
      const storeResult =
        !localMode && candidate.artifact?.path
          ? platform === "android"
            ? await new GooglePlayApiProvider(credentials.googlePlay!).submit({
                platform,
                path: candidate.artifact.path,
                hash: candidate.artifact.hash,
              })
            : await new AppStoreConnectApiProvider(
                credentials.appStoreConnect!,
              ).submit({
                platform,
                path: candidate.artifact.path,
                hash: candidate.artifact.hash,
              })
          : undefined;
      const submission = storeResult
        ? {
            ...(controlPlaneSubmission as Record<string, unknown>),
            store: storeResult,
          }
        : controlPlaneSubmission;
      const result = submission as {
        id?: string;
        platform?: string;
        status?: string;
        downloadUrl?: string;
        downloadExpiresAt?: string;
      };
      spinner.succeed(
        storeResult
          ? "Artifact submitted to the configured app store"
          : "Local submission job accepted",
      );
      await saveState(state, repository, builds, submissions);
      printValue(submission, {
        title: "Submission result",
        rows: [
          {
            label: "Submission ID",
            value: result.id ?? "remote",
            valueColor: "purple",
          },
          {
            label: "Platform",
            value: result.platform ?? platform,
            valueColor: "blue",
          },
          {
            label: "Status",
            value: result.status ?? "accepted",
            valueColor: "green",
          },
        ],
        done: "App submitted to the configured provider.",
      });
      if (result.downloadUrl)
        ui.downloadArtifact(result.downloadUrl, result.downloadExpiresAt);
    } catch (error) {
      spinner.fail(
        error instanceof Error ? error.message : "Submission failed",
      );
      throw error;
    }
    return;
  }

  if (command === "update") {
    const config = await loadConfig(root);
    const platform = platformValue(flag("--platform", "android")!);
    await requireOperationalConfiguration(platform);
    const projectId = config.projectId ?? "local_project";
    const localMode =
      args.includes("--local") || process.env.LYNXSHIP_SUBMIT_MODE === "mock";
    const explicitBundles = flag("--bundle");
    const runtime = await inspectRuntimeFingerprint(root, platform, config);
    const progress = ui.progress("Sign manifest");
    try {
      if (localMode) {
        const key = state.signingKey ?? createSigningKey();
        const data = flag("--bundle", "local-bundle")!;
        const manifest = {
          protocolVersion: 1,
          projectId,
          channel: config.update?.channel ?? "production",
          platform,
          runtimeVersion: runtime.value,
          sequence: state.releases.length + 1,
          keyId: key.keyId,
          assets: [
            {
              path: "main.js",
              hash: sha256(data),
              size: Buffer.byteLength(data),
            },
          ],
        };
        const release: CliRelease = {
          id: createId("rel"),
          manifest,
          signature: signManifest(manifest, key.privateKey),
          message: flag("--message", "local update")!,
          createdAt: new Date().toISOString(),
        };
        state.releases.push(release);
        await saveState(state, repository, builds, submissions);
        progress.update(100);
        printValue(release, {
          title: "OTA update published locally",
          rows: [
            { label: "Release ID", value: release.id, valueColor: "purple" },
            {
              label: "Platform",
              value: release.manifest.platform,
              valueColor: "blue",
            },
            {
              label: "Signature",
              value: "Ed25519 signed",
              valueColor: "muted",
            },
          ],
          done: "Local update created. Use a real API and bundle for devices.",
        });
        return;
      }

      const bundlePaths = await otaAssetPaths(root, explicitBundles);
      for (const bundlePath of bundlePaths)
        assert(
          await exists(bundlePath),
          "OTA_BUNDLE_REQUIRED",
          `Bundle not found: ${bundlePath}. Build the Lynx bundle first or pass --bundle.`,
        );
      assertCompatibleBinaryBuild(builds, platform, runtime.value);
      const releaseId = createId("ota");
      progress.update(
        25,
        `Uploading ${bundlePaths.length} Lynx asset(s) to Cloudflare R2…`,
      );
      const uploadedAssets = [];
      for (const [index, bundlePath] of bundlePaths.entries()) {
        const uploaded = await uploadR2Artifact(
          root,
          projectId,
          releaseId,
          bundlePath,
          "application/octet-stream",
          otaAssetName(root, bundlePath),
        );
        uploadedAssets.push({
          path: otaAssetName(root, bundlePath),
          hash: uploaded.hash,
          size: uploaded.size,
          url: uploaded.url,
        });
        progress.update(
          25 + Math.round(((index + 1) / bundlePaths.length) * 35),
          `Uploaded ${index + 1}/${bundlePaths.length} Lynx asset(s)…`,
        );
      }
      progress.update(
        65,
        "Publishing signed OTA release through LynxShip API…",
      );
      const remoteRelease = (await publishOtaRelease(config, state, {
        projectId,
        organizationId: "local_org",
        channel: config.update?.channel ?? "production",
        platform,
        runtimeVersion: runtime.value,
        assets: uploadedAssets,
        message: flag("--message", "OTA update")!,
        rollout: config.update?.rollout?.defaultPercentage ?? 100,
        policyApprovalId: flag("--policy-approval-id"),
      })) as CliRelease;
      const publicKey = await fetchOtaPublicKey(config);
      state.releases.push(remoteRelease);
      await saveState(state, repository, builds, submissions);
      progress.update(100, "OTA release signed and published");
      printValue(
        { ...remoteRelease, signingKey: publicKey },
        {
          title: "OTA update published",
          rows: [
            {
              label: "Release ID",
              value: remoteRelease.id,
              valueColor: "purple",
            },
            {
              label: "Platform",
              value: remoteRelease.manifest.platform,
              valueColor: "blue",
            },
            { label: "Bundle", value: "Cloudflare R2", valueColor: "orange" },
            {
              label: "Signature",
              value: "Ed25519 signed by API",
              valueColor: "green",
            },
          ],
          done: "Devices can check and install this compatible OTA release.",
        },
      );
    } finally {
      progress.stop();
    }
    return;
  }

  assert(command === "build", "CLI_COMMAND", `Unknown command: ${command}`);
  const subcommand =
    args[0] && !args[0].startsWith("--") ? args.shift() : "create";
  const platform = platformValue(flag("--platform", "android")!);
  await requireOperationalConfiguration(platform);
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
    subcommand === "create",
    "CLI_BUILD_COMMAND",
    `Unknown build command: ${subcommand}`,
  );
  const config = await loadConfig(root);
  const profile = flag("--profile", "production")!;
  await requireAutolinkReady(root, platform);
  const runtime = await inspectRuntimeFingerprint(root, platform, config);
  const job = await builds.create({
    projectId: config.projectId ?? "local_project",
    organizationId: "local_org",
    platform,
    profile,
    sourceHash: createHash("sha256").update(root).digest("hex"),
    runtimeVersion: runtime.value,
    runtimeInputs: runtime.inputs,
  });
  ui.info(`Using profile: ${profile} · platform: ${platform}`);
  const progress = ui.progress("Build execution");
  try {
    progress.update(undefined, "Preparing build pipeline…");
    if (!args.includes("--no-wait")) {
      const realAndroid =
        platform === "android" && (await hasAndroidHost(root));
      const realIos =
        platform === "ios" && hasIosHost(root, config.build?.[profile]);
      if (platform === "ios" && !realIos && !args.includes("--local"))
        assert(
          false,
          "IOS_HOST_REQUIRED",
          "A macOS Xcode host is required for a real iOS build. No local fake iOS build is created.",
        );
      if (realAndroid) {
        await runRealAndroidBuild(job, {
          root,
          profile: config.build?.[profile] ?? {},
          quiet: json,
          onEvent: (message) => progress.event(message),
          onProgress: (value, label) => progress.update(value, label),
        });
      } else if (realIos) {
        await runRealIosBuild(job, {
          root,
          profile: config.build?.[profile] ?? {},
          quiet: json,
          onEvent: (message) => progress.event(message),
          onProgress: (value, label) => progress.update(value, label),
        });
      } else {
        await builds.run(job.id);
      }
    }
    progress.update(100);
    await saveState(state, repository, builds, submissions);
  } catch (error) {
    await saveState(state, repository, builds, submissions);
    throw error;
  } finally {
    progress.stop();
  }
  const result = builds.get(job.id);
  printValue(result, {
    title: "Build result",
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

function exitCode(error: unknown): number {
  const code = (error as { code?: string }).code;
  if (code?.startsWith("CLI_") || code?.startsWith("CONFIG_")) return 2;
  if (code === "BUILD_SIGNING_REQUIRED") return 2;
  if (code?.startsWith("AUTH_")) return 4;
  if (code?.startsWith("BUILD_")) return 5;
  if (code?.startsWith("SUBMISSION_")) return 6;
  if (code?.startsWith("OTA_")) return 7;
  return 1;
}

void main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (json) {
      console.log(
        JSON.stringify({
          error: message,
          code: (error as { code?: string }).code ?? "CLI_ERROR",
        }),
      );
    } else {
      ui.error(message);
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
