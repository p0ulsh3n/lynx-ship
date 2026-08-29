import { basename, join } from "node:path";
import { assert } from "@lynxship/contracts";
import {
  configureAndroid,
  configureAppStoreConnect,
  configureGooglePlay,
  configureR2,
} from "../configure.js";
import {
  initializeAndroidHost,
  suggestedAndroidApplicationId,
} from "../android-host.js";
import {
  initializeIosHost,
  suggestedIosBundleIdentifier,
} from "../ios-host.js";
import { credentialStorageDescription } from "../secure-store.js";
import type { ProjectCommandContext } from "./project.js";
import type { BoxRow, CliUi } from "../ui/index.js";

export interface ConfigurationCommandContext {
  root: string;
  args: string[];
  ui: CliUi;
  flag: (name: string, fallback?: string | null) => string | null;
  printValue: (
    value: unknown,
    view?: { title: string; rows: BoxRow[]; done: string },
  ) => void;
  project: ProjectCommandContext;
  assertInteractivePrompt: (
    label: string,
    fallback: string,
    optionName: string,
  ) => Promise<string>;
  initializeBuildProject: (context: ProjectCommandContext) => Promise<unknown>;
  mobilePlatformValue: (value: string) => "android" | "ios";
}

export async function runConfigurationCommands(
  context: ConfigurationCommandContext,
  command: string,
): Promise<void> {
  const {
    root,
    args,
    ui,
    flag,
    printValue,
    project,
    assertInteractivePrompt,
    initializeBuildProject,
    mobilePlatformValue,
  } = context;

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
    await initializeBuildProject(project);
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
      appIcon: flag("--icon") ?? undefined,
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
      await initializeBuildProject(project);
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
}
