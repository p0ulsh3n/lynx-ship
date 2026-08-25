#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { BuildOrchestrator } from "@lynxship/build-orchestrator";
import { JsonRepository } from "@lynxship/db";
import {
  assert,
  createId,
  sha256,
  type BuildJob,
  type MobilePlatform,
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
import {
  DEFAULT_CONFIG,
  loadConfig,
  platformValue,
  resolveProfile,
  type LynxShipConfig,
} from "./config.js";
import {
  hasAndroidHost,
  isSupportedAndroidPlatform,
  runRealAndroidBuild,
} from "./android-build.js";
import {
  initializeAndroidHost,
  suggestedAndroidApplicationId,
} from "./android-host.js";
import { initializeIosHost, suggestedIosBundleIdentifier } from "./ios-host.js";
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
  rollbackOtaRelease,
  submitRealArtifact,
  type RemoteCliState,
} from "./remote.js";
import { uploadR2Artifact } from "./r2.js";
import {
  credentialStorageDescription,
  loadCredentials,
} from "./secure-store.js";
import { createCliUi, type BoxRow, type ProgressHandle } from "./ui/index.js";
import { globalLynxShipDirectory } from "./paths.js";
import { inspectAutolink, requireAutolinkReady } from "./autolink.js";
import {
  assertCompatibleBinaryBuild,
  inspectRuntimeFingerprint,
} from "./runtime-fingerprint.js";
import { inspectOtaHost } from "./ota-doctor.js";
import { otaAssetName, otaAssetPaths } from "./ota-assets.js";
import { confirm, prompt } from "./prompt.js";
import {
  commandExists,
  packageManagerCommand,
  runProcess,
  runRspeedy,
} from "./process-runner.js";
import { guidanceForError } from "./guidance.js";
import { buildLynxBundle } from "./bundle-build.js";
import {
  fixAndroidToolchain,
  formatAndroidToolchainFailure,
  inspectAndroidToolchain,
} from "./android-toolchain.js";
import {
  formatIosToolchainFailure,
  inspectIosToolchain,
} from "./ios-toolchain.js";
import { formatDevToolFailure, inspectLynxDevTool } from "./lynx-devtool.js";
import { hasHarmonyHost, runRealHarmonyBuild } from "./harmony-build.js";
import { hasWebConfiguration, runRealWebBuild } from "./web-build.js";
import { hasDesktopHost, runRealDesktopBuild } from "./desktop-build.js";
import { extractDevServerUrl, shouldPrintDevServerQr } from "./dev-qr.js";
import {
  inspectDesktopTarget,
  inspectHarmonyTarget,
  inspectWebTarget,
} from "./target-toolchain.js";

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
  lastRollback?: { releaseId: string; reason: string; at: string };
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
  const next = stateSaveQueue.then(async () => {
    state.builds = builds.list();
    state.submissions = submissions.list();
    await repository.write(state);
  });
  stateSaveQueue = next.catch(() => undefined);
  await next;
}

let stateSaveQueue = Promise.resolve();

interface BuildExecutionOptions {
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
}

async function executeBuild(
  options: BuildExecutionOptions,
  showResult = true,
): Promise<BuildJob> {
  const {
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
  } = options;
  if (wait && !local) await ensureNativeHostForBuild(platform, profile, config);
  // Host initialization can write lynxship.json (for example, the generated
  // iOS scheme). Always read it again before resolving the build profile so a
  // first build uses the host that was just created in the same invocation.
  const effectiveConfig = wait && !local ? await loadConfig(root) : config;
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

async function buildSharedLynxBundle(): Promise<void> {
  const progress = ui.progress("Shared Lynx bundle");
  try {
    progress.update(
      undefined,
      "Building the shared Lynx bundle once for native targets…",
    );
    await buildLynxBundle(root, {
      quiet: json,
      onOutput: (message) => progress.event(message),
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
      rollback: "OTA Rollback",
      "self-host": "Self-host setup",
      storage: "Cloudflare R2 setup",
      android: "Android signing setup",
      store: "App store submission setup",
      devtool: "Lynx DevTool diagnostics",
      trace: "Lynx Trace diagnostics",
      recorder: "Lynx Recorder diagnostics",
    }[command] ?? command
  );
}

function helpText(): string {
  return `lynxship <command> [options]

Commands:
  init                    Initialize or link a LynxShip project
  doctor                  Check the local toolchain and project
  dev                     Run Rspeedy dev with Lynx Explorer QR/HMR
  preview                 Preview the production Lynx bundle locally
  inspect                 Inspect Rspeedy/Rspack configuration
  profile                 Build with Rspack profiling enabled
  devtool doctor          Check Lynx DevTool integration and dev runtime
  trace doctor            Check Lynx Trace prerequisites
  recorder doctor         Check Lynx Recorder prerequisites
  autolink check          Check Lynx native-library Autolink wiring
  autolink codegen        Run the project's Native Module codegen script
  ota doctor              Check native OTA host integration
  run                     Install an artifact on an Android/iOS/HarmonyOS target
  logs                    Stream Android/iOS/HarmonyOS native logs
  build create            Create a local/cloud build job
  build list              List build jobs
  build status <id>       Show one build job
  build cancel <id>       Cancel a build job
  build retry <id>        Retry a failed build job
  build all               Build Android, iOS, HarmonyOS, Web and Desktop
  submit                  Submit the latest successful build
  update                  Upload and publish a signed OTA update
  update rollback         Roll back an OTA channel to a previous release
  rollback                Alias for update rollback
  self-host init          Generate local self-host credentials
  storage configure       Configure Cloudflare R2 and encrypted R2 credentials
  android host init       Create a minimal official Lynx Android host
  ios host init           Create a minimal official Lynx iOS/Xcode host
  android configure       Configure or generate encrypted Android signing credentials
  store configure         Configure Google Play or App Store Connect submission

Build options:
  --platform <p>          Target android, ios, harmony, web, desktop or all (default: android)
  --profile <name>        Build profile (default: production; simulator uses simulator)
  --no-wait               Queue the build without executing it locally
  --no-upload              Keep the artifact local and skip R2 (CI verification)
  --simulator             Build and install an iOS Simulator .app locally
  --device <id>           Select the iOS Simulator device for a simulator build
  --allow-unsigned         Allow an unsigned Desktop artifact only with --no-upload (local tests)
  --local                 Use the contract-only build path for tests

Submit options:
  --platform <p>          Target android or ios (default: android)
  --latest                Submit the latest successful build
  --local                 Use the mock submission provider for tests

Update options:
  --platform <p>          Target android or ios (default: android)
  --bundle <path[,path]>  Lynx bundle/assets (default: discover dist/*.lynx.bundle)
  --message <text>        Release message
  --local                 Create a local contract-only update for tests
  --policy-approval-id    Required for an iOS OTA release

Rollback options:
  --platform <p>          Target android or ios (default: android)
  --release-id <id>       Previously published compatible release
  --reason <text>         Required audit reason for the rollback
  --local                 Roll back local contract state for tests

Device and diagnostics options:
  doctor --platform <p>   Check the local toolchain (default: android)
  doctor --fix            Install missing Android SDK packages after confirmation
  autolink check --platform <p>
                          Check native-library wiring (default: android)
  ota doctor --platform <p>
                          Check OTA host integration (default: android)
  run --artifact <path>   Install a specific APK, IPA, app or signed HAP
  run --device <id>       Select an Android, iOS or HarmonyOS device
  run --simulator         Install an iOS .app with simctl
  logs --device <id>      Select the device or simulator for native logs

Global options:
  --json                  Emit one stable JSON result/error object
  --quiet                 Print only the final machine-relevant result
  --verbose               Include extra operational context
  --no-color              Disable ANSI colors
  --non-interactive       Never prompt; fail on missing inputs
  --banner                Show the Braille LynxShip logo in a TTY
  --project-dir <path>    Use a LynxShip project from any working directory
  --project-id <id>       Project ID used by init
  --application-id <id>   Android package/application ID for host init
  --bundle-identifier <id> iOS bundle identifier for host init
  --library-dir <path>    Native library directory for autolink codegen
  --simulator             Build/install an iOS .app or install one with simctl
  --help                  Show this complete command reference

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

async function initializeProject(): Promise<string> {
  const file = join(root, "lynxship.json");
  if (await exists(file)) return file;
  await mkdir(join(root, ".lynxship"), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      { ...DEFAULT_CONFIG, projectId: flag("--project-id") ?? randomUUID() },
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

async function ensureNativeHostForBuild(
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
    if (await hasAndroidHost(root)) return;

    assert(
      !(await exists(join(root, "android"))),
      "ANDROID_HOST_EXISTS",
      "An android/ directory exists but does not contain a usable Gradle host. LynxShip will not overwrite it; repair it or remove it deliberately, then rerun the build.",
    );
    const suggestedId = suggestedAndroidApplicationId(root);
    const applicationId =
      flag("--application-id") ??
      (ui.interactive
        ? await prompt("Android application ID", suggestedId)
        : "");
    assert(
      applicationId,
      "ANDROID_HOST_REQUIRED",
      `No Android Gradle host exists. Run \`lynxship android host init --application-id ${suggestedId}\` or pass --application-id <id> to build in non-interactive mode.`,
    );
    ui.info(
      "No Android host found. Creating the official LynxShip host before the build…",
    );
    const result = await initializeAndroidHost(root, {
      applicationId,
      appName: basename(root),
    });
    ui.success(`Android host created: ${result.directory}`);
    return;
  }

  if (platform === "web") {
    const resolvedProfile = resolveProfile(config, profile);
    assert(
      hasWebConfiguration(root) || Boolean(resolvedProfile.web?.script),
      "WEB_CONFIGURATION_REQUIRED",
      "No Lynx Web configuration was detected. Add environments.web to lynx.config.* or configure build.<profile>.web.script.",
    );
    return;
  }

  if (platform === "harmony") {
    assert(
      hasHarmonyHost(root),
      "HARMONY_HOST_REQUIRED",
      "No complete HarmonyOS host was found. Add an official Lynx Harmony host under harmony/ before building.",
    );
    return;
  }

  if (platform === "desktop") {
    const resolvedProfile = resolveProfile(config, profile);
    assert(
      await hasDesktopHost(root, resolvedProfile),
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
  if (hasIosHost(root, resolvedProfile)) return;

  assert(
    !(await exists(join(root, "ios"))),
    "IOS_HOST_EXISTS",
    "An ios/ directory exists but does not contain a usable Xcode host. LynxShip will not overwrite it; repair it deliberately, then rerun the build.",
  );
  const suggestedId = suggestedIosBundleIdentifier(root);
  const bundleIdentifier =
    flag("--bundle-identifier") ??
    (ui.interactive ? await prompt("iOS bundle identifier", suggestedId) : "");
  assert(
    bundleIdentifier,
    "IOS_HOST_REQUIRED",
    `No iOS host exists. Run \`lynxship ios host init --bundle-identifier ${suggestedId}\` or pass --bundle-identifier <id> to build in non-interactive mode.`,
  );
  ui.info(
    "No iOS host found. Creating the official LynxShip host before the build…",
  );
  const result = await initializeIosHost(root, {
    bundleIdentifier,
    appName: basename(root),
  });
  ui.success(`iOS host created: ${result.directory}`);
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
  if (subcommand === "dev") {
    ui.info(
      "Lynx Explorer mode: no Android or iOS native host is required. Scan the QR code printed by Rspeedy; source changes reload automatically.",
    );
  }
  let devUrl: string | undefined;
  let devQrPrinted = false;
  let devQrTimer: NodeJS.Timeout | undefined;
  const printDevQr = (): void => {
    if (!devUrl || devQrPrinted || json || ui.options.quiet) return;
    devQrPrinted = true;
    if (devQrTimer) clearTimeout(devQrTimer);
    ui.devServerQr(devUrl);
  };
  await runRspeedy(root, subcommand, forwarded, {
    env: environment,
    quiet: json,
    onOutput: (line) => {
      ui.info(`│ ${line}`);
      if (subcommand !== "dev") return;
      const url = extractDevServerUrl(line);
      if (url && (!devUrl || url.includes("fullscreen=true"))) {
        devUrl = url;
        if (devQrTimer) clearTimeout(devQrTimer);
        devQrTimer = setTimeout(printDevQr, 500);
      }
      if (devUrl && shouldPrintDevServerQr(line)) printDevQr();
    },
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

async function runDevToolDoctor(
  kind: "devtool" | "trace" | "recorder",
): Promise<void> {
  await initializeBuildProject();
  const platform = mobilePlatformValue(flag("--platform", "android")!);
  const status = await inspectLynxDevTool(root, platform);
  const ready =
    kind === "devtool"
      ? status.ok
      : kind === "trace"
        ? status.traceReady
        : status.recorderReady;
  if (!ready) process.exitCode = 1;
  printValue(
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
  } else if (platform === "ios") {
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
  } else if (platform === "harmony") {
    assert(
      commandExists("hdc"),
      "HARMONY_HDC_REQUIRED",
      "hdc was not found in PATH. Install the OpenHarmony SDK platform tools before installing a HAP.",
    );
    assert(
      artifactPath.endsWith(".hap"),
      "DEVICE_ARTIFACT_INVALID",
      "HarmonyOS run requires a signed .hap artifact.",
    );
    const device = flag("--device");
    await runProcess(
      "hdc",
      device
        ? ["-t", device, "install", "-r", artifactPath]
        : ["install", "-r", artifactPath],
      {
        cwd: root,
        quiet: json,
        onOutput: (line) => ui.info(`│ ${line}`),
      },
    );
  } else {
    assert(
      false,
      "TARGET_RUN_UNSUPPORTED",
      platform === "web"
        ? "Web artifacts are previewed with `lynxship preview` or served by the project; they are not installed on a device."
        : "Desktop installers are launched by the operating system after packaging; LynxShip does not claim a cross-platform install command.",
    );
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
  const device = flag("--device", platform === "ios" ? "booted" : undefined);
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
  } else if (platform === "ios") {
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
  } else if (platform === "harmony") {
    assert(
      commandExists("hdc"),
      "HARMONY_HDC_REQUIRED",
      "hdc was not found in PATH. Install the OpenHarmony SDK platform tools before streaming logs.",
    );
    const argsForHdc = device
      ? ["-t", device, "shell", "hilog"]
      : ["shell", "hilog"];
    await runProcess("hdc", argsForHdc, {
      cwd: root,
      quiet: json,
      onOutput: (line) => ui.info(`│ ${line}`),
    });
  } else {
    assert(
      false,
      "TARGET_LOGS_UNSUPPORTED",
      platform === "web"
        ? "Web logs are emitted by the browser/runtime console; use lynxship dev or the project's Web DevTools."
        : "Desktop logs are emitted by the packaged runtime; use the target OS logging tools.",
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
    await initializeProject();
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

  if (command === "doctor") {
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
    const lockfile = await findLockfile(root);
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
    const checks = [
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
        name: "package-manager-lockfile",
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

  if (["devtool", "trace", "recorder"].includes(command)) {
    const subcommand = args.shift() ?? "doctor";
    assert(
      subcommand === "doctor",
      "CLI_DEVTOOL_COMMAND",
      "Use `lynxship devtool doctor`, `lynxship trace doctor` or `lynxship recorder doctor`.",
    );
    await runDevToolDoctor(command as "devtool" | "trace" | "recorder");
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

  if (command === "ios") {
    const subcommand = args.shift() ?? "host";
    assert(
      subcommand === "host" && (args.shift() ?? "init") === "init",
      "CLI_IOS_HOST_COMMAND",
      "Use `lynxship ios host init` to create an iOS host.",
    );
    await initializeBuildProject();
    const suggestedId = suggestedIosBundleIdentifier(root);
    const bundleIdentifier =
      flag("--bundle-identifier") ??
      (await assertInteractivePrompt(
        "iOS bundle identifier",
        suggestedId,
        "--bundle-identifier",
      ));
    const result = await initializeIosHost(root, {
      bundleIdentifier,
      appName: basename(root),
    });
    ui.success(`iOS host created: ${result.directory}`);
    printValue(
      {
        status: "created",
        platform: "ios",
        directory: result.directory,
        bundleIdentifier: result.bundleIdentifier,
        project: result.project,
        scheme: result.scheme,
        configUpdated: result.configUpdated,
      },
      {
        title: "iOS host",
        rows: [
          {
            label: "Bundle identifier",
            value: result.bundleIdentifier,
            valueColor: "blue",
          },
          {
            label: "Xcode project",
            value: result.project,
            valueColor: "green",
          },
          { label: "Scheme", value: result.scheme, valueColor: "purple" },
          {
            label: "CocoaPods",
            value: "Run pod install on macOS before the first build",
            valueColor: "yellow",
          },
        ],
        done: "iOS host is ready. Run lynxship doctor --platform ios on macOS.",
      },
    );
    return;
  }

  if (command === "android") {
    const subcommand = args.shift() ?? "configure";
    if (subcommand === "host") {
      assert(
        (args.shift() ?? "init") === "init",
        "CLI_ANDROID_HOST_COMMAND",
        "Use `lynxship android host init` to create an Android host.",
      );
      await initializeBuildProject();
      const suggestedId = suggestedAndroidApplicationId(root);
      const applicationId =
        flag("--application-id") ??
        (await assertInteractivePrompt(
          "Android application ID",
          suggestedId,
          "--application-id",
        ));
      const result = await initializeAndroidHost(root, {
        applicationId,
        appName: basename(root),
      });
      ui.success(`Android host created: ${result.directory}`);
      printValue(
        {
          status: "created",
          platform: "android",
          directory: result.directory,
          applicationId: result.applicationId,
        },
        {
          title: "Android host",
          rows: [
            {
              label: "Application ID",
              value: result.applicationId,
              valueColor: "blue",
            },
            {
              label: "Gradle wrapper",
              value: join(result.directory, "gradlew"),
              valueColor: "green",
            },
          ],
          done: "Android host is ready. Run lynxship doctor, then lynxship build.",
        },
      );
      return;
    }
    assert(
      ui.interactive,
      "CLI_INTERACTIVE_REQUIRED",
      "Run `lynxship android configure` in an interactive terminal",
    );
    assert(
      subcommand === "configure",
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
    const platform = mobilePlatformValue(flag("--platform", "android")!);
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
    const platform = mobilePlatformValue(flag("--platform", "android")!);
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
            projectId: configuredProjectId(config),
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

  if (command === "update" && args[0] !== "rollback") {
    const config = await loadConfig(root);
    const platform = mobilePlatformValue(flag("--platform", "android")!);
    await requireOperationalConfiguration(platform);
    const projectId = configuredProjectId(config);
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

  if (
    command === "rollback" ||
    (command === "update" && args[0] === "rollback")
  ) {
    if (command === "update") args.shift();
    const config = await loadConfig(root);
    const platform = mobilePlatformValue(flag("--platform", "android")!);
    const releaseId = flag("--release-id");
    const reason = flag("--reason");
    const channel = config.update?.channel ?? "production";
    const localMode = args.includes("--local");
    assert(
      Boolean(releaseId && releaseId !== "true"),
      "ROLLBACK_RELEASE_REQUIRED",
      "Pass the release to restore with `--release-id <id>`.",
    );
    assert(
      Boolean(reason?.trim()) && reason !== "true",
      "ROLLBACK_REASON_REQUIRED",
      'Pass an audit reason with `--reason "..."`.',
    );
    await requireR2Configuration();
    const progress = ui.progress("OTA rollback");
    try {
      progress.update(10, `Selecting ${releaseId} for ${channel}…`);
      if (localMode) {
        const release = state.releases.find(
          (candidate) =>
            candidate.id === releaseId &&
            candidate.manifest.channel === channel &&
            candidate.manifest.platform === platform,
        );
        assert(
          release,
          "RELEASE_NOT_FOUND",
          `Local release ${releaseId} was not found in channel ${channel} for ${platform}.`,
        );
        state.lastRollback = {
          releaseId: release.id,
          reason: reason!,
          at: new Date().toISOString(),
        };
        await saveState(state, repository, builds, submissions);
        progress.update(100, "Local OTA channel rolled back");
        printValue(
          { status: "rolled_back", release, rollback: state.lastRollback },
          {
            title: "OTA rollback",
            rows: [
              { label: "Release ID", value: release.id, valueColor: "purple" },
              { label: "Platform", value: platform, valueColor: "blue" },
              { label: "Channel", value: channel, valueColor: "orange" },
              { label: "Reason", value: reason!, valueColor: "muted" },
            ],
            done: "Local OTA channel now points to the selected release.",
          },
        );
        return;
      }

      progress.update(45, "Requesting rollback through LynxShip API…");
      const release = (await rollbackOtaRelease(config, state, {
        projectId: configuredProjectId(config),
        channel,
        platform,
        releaseId: releaseId!,
        reason: reason!,
      })) as CliRelease;
      state.lastRollback = {
        releaseId: release.id,
        reason: reason!,
        at: new Date().toISOString(),
      };
      await saveState(state, repository, builds, submissions);
      progress.update(100, "OTA channel rolled back");
      printValue(
        { status: "rolled_back", release, rollback: state.lastRollback },
        {
          title: "OTA rollback",
          rows: [
            { label: "Release ID", value: release.id, valueColor: "purple" },
            { label: "Platform", value: platform, valueColor: "blue" },
            { label: "Channel", value: channel, valueColor: "orange" },
            { label: "Reason", value: reason!, valueColor: "muted" },
          ],
          done: "Devices will receive the selected compatible release on their next OTA check.",
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
      await ensureNativeHostForBuild(target, profile, config);
  }

  if (!buildAll) {
    await executeBuild({
      config,
      profile,
      platform,
      skipUpload,
      allowUnsigned,
      wait,
      local,
      simulator,
      simulatorDevice,
      state,
      repository,
      builds,
      submissions,
    });
    return;
  }

  if (buildAll && wait && !local) await buildSharedLynxBundle();

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
          config,
          profile,
          platform: target,
          skipUpload,
          allowUnsigned,
          wait,
          local,
          simulator,
          simulatorDevice,
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

function exitCode(error: unknown): number {
  const code = (error as { code?: string }).code;
  if (code?.startsWith("CLI_") || code?.startsWith("CONFIG_")) return 2;
  if (code === "BUILD_SIGNING_REQUIRED") return 2;
  if (code === "DESKTOP_SIGNING_REQUIRED") return 2;
  if (code?.startsWith("AUTH_")) return 4;
  if (code?.startsWith("BUILD_")) return 5;
  if (code?.startsWith("SUBMISSION_")) return 6;
  if (code?.startsWith("OTA_")) return 7;
  return 1;
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
