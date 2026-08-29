import { resolve } from "node:path";
import { assert } from "@lynxship/contracts";
import { commandExists, runProcess } from "../process-runner.js";
import { loadState } from "../runtime/state.js";
import { launchIosSimulatorApp } from "../ios-build.js";
import { platformValue } from "../config.js";
import type { DevelopmentCommandContext } from "./development.js";

export async function runDevice(
  context: DevelopmentCommandContext,
): Promise<void> {
  const platform = platformValue(context.flag("--platform", "android")!);
  const artifact = context.flag("--artifact");
  const artifactPath = artifact
    ? resolve(context.root, artifact)
    : (await loadState(context.root)).builds
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
    const device = context.flag("--device");
    const argsForAdb = device
      ? ["-s", device, "install", "-r", artifactPath]
      : ["install", "-r", artifactPath];
    await runProcess("adb", argsForAdb, {
      cwd: context.root,
      quiet: context.json,
      onOutput: (line) => context.ui.info(`│ ${line}`),
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
    const device = context.flag("--device", "booted")!;
    const simulator = context.args.includes("--simulator");
    if (simulator || artifactPath.endsWith(".app")) {
      await runProcess("xcrun", ["simctl", "install", device, artifactPath], {
        cwd: context.root,
        quiet: context.json,
        onOutput: (line) => context.ui.info(`│ ${line}`),
      });
      if (context.args.includes("--launch")) {
        await launchIosSimulatorApp(context.root, device, artifactPath, {
          quiet: context.json,
          onEvent: (line) => context.ui.info(`│ ${line}`),
        });
      }
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
          cwd: context.root,
          quiet: context.json,
          onOutput: (line) => context.ui.info(`│ ${line}`),
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
    const device = context.flag("--device");
    await runProcess(
      "hdc",
      device
        ? ["-t", device, "install", "-r", artifactPath]
        : ["install", "-r", artifactPath],
      {
        cwd: context.root,
        quiet: context.json,
        onOutput: (line) => context.ui.info(`│ ${line}`),
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
  context.printValue(
    { status: "installed", platform, artifact: artifactPath },
    {
      title: "Device install",
      rows: [{ label: "Artifact", value: artifactPath, valueColor: "green" }],
      done: "Artifact installed on the selected target.",
    },
  );
}
