import { assert } from "@lynxship/contracts";
import { commandExists, runProcess } from "../process-runner.js";
import { platformValue } from "../config.js";
import type { DevelopmentCommandContext } from "./development.js";

export async function streamNativeLogs(
  context: DevelopmentCommandContext,
): Promise<void> {
  const platform = platformValue(context.flag("--platform", "android")!);
  const device = context.flag(
    "--device",
    platform === "ios" ? "booted" : undefined,
  );
  if (platform === "android") {
    assert(
      commandExists("adb"),
      "ANDROID_ADB_REQUIRED",
      "adb was not found in PATH",
    );
    await runProcess("adb", device ? ["-s", device, "logcat"] : ["logcat"], {
      cwd: context.root,
      quiet: context.json,
      onOutput: (line) => context.ui.info(`│ ${line}`),
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
      {
        cwd: context.root,
        quiet: context.json,
        onOutput: (line) => context.ui.info(`│ ${line}`),
      },
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
      cwd: context.root,
      quiet: context.json,
      onOutput: (line) => context.ui.info(`│ ${line}`),
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
