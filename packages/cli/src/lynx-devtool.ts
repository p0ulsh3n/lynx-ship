import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Platform } from "@lynxship/contracts";
import { commandExists } from "./process-runner.js";

export type DevToolCheckStatus = "pass" | "warn" | "fail";

export interface DevToolCheck {
  name: string;
  status: DevToolCheckStatus;
  value: string;
  fix?: string;
}

export interface LynxDevToolStatus {
  platform: Platform;
  checks: DevToolCheck[];
  ok: boolean;
  traceReady: boolean;
  recorderReady: boolean;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function readPackageJson(root: string): Promise<PackageJson> {
  try {
    return JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as PackageJson;
  } catch {
    return {};
  }
}

function dependencyVersion(
  packageJson: PackageJson,
  packageName: string,
): string | undefined {
  return (
    packageJson.dependencies?.[packageName] ??
    packageJson.devDependencies?.[packageName]
  );
}

function hasDevVersion(text: string): boolean {
  return /(?:^|[^\w])(?:["']?\d[^\s"']*-dev|version\s*[=:]\s*["']?\d[^\s"']*-dev)/i.test(
    text,
  );
}

function hasPackageMarker(text: string, packageName: string): boolean {
  return text.includes(packageName);
}

async function readIfExists(file: string): Promise<string> {
  if (!existsSync(file)) return "";
  return readFile(file, "utf8").catch(() => "");
}

function check(
  name: string,
  status: DevToolCheckStatus,
  value: string,
  fix?: string,
): DevToolCheck {
  return { name, status, value, ...(fix ? { fix } : {}) };
}

export async function inspectLynxDevTool(
  root: string,
  platform: Platform,
): Promise<LynxDevToolStatus> {
  const packageJson = await readPackageJson(root);
  const checks: DevToolCheck[] = [];
  const hasDevScript = Boolean(packageJson.scripts?.dev);
  checks.push(
    check(
      "rspeedy-dev",
      hasDevScript ? "pass" : "fail",
      hasDevScript
        ? "package.json dev script found"
        : "missing package.json dev script",
      hasDevScript
        ? undefined
        : "add a project dev script that runs rspeedy dev",
    ),
  );

  const rspeedy = dependencyVersion(packageJson, "@lynx-js/rspeedy");
  checks.push(
    check(
      "rspeedy",
      rspeedy ? "pass" : "fail",
      rspeedy ? `configured · ${rspeedy}` : "@lynx-js/rspeedy is not declared",
      rspeedy
        ? undefined
        : "install the project’s pinned @lynx-js/rspeedy version",
    ),
  );

  const devtoolPath = process.env.LYNXSHIP_DEVTOOL_PATH;
  const desktopAvailable = Boolean(devtoolPath && existsSync(devtoolPath));
  checks.push(
    check(
      "lynx-devtool-desktop",
      desktopAvailable ? "pass" : "warn",
      desktopAvailable
        ? `configured · ${devtoolPath}`
        : "Desktop application not registered in LYNXSHIP_DEVTOOL_PATH",
      desktopAvailable
        ? undefined
        : "install Lynx DevTool Desktop, then optionally set LYNXSHIP_DEVTOOL_PATH",
    ),
  );

  if (platform === "android") {
    const settings = await readIfExists(
      join(root, "android", "settings.gradle"),
    );
    const settingsKts = await readIfExists(
      join(root, "android", "settings.gradle.kts"),
    );
    const app = await readIfExists(
      join(root, "android", "app", "build.gradle"),
    );
    const appKts = await readIfExists(
      join(root, "android", "app", "build.gradle.kts"),
    );
    const hostText = `${settings}\n${settingsKts}\n${app}\n${appKts}`;
    const hostExists = Boolean(settings || settingsKts || app || appKts);
    const hasTrace = hasPackageMarker(hostText, "lynx-trace");
    const hasDevTool = hasPackageMarker(hostText, "lynx-devtool");
    const devRuntime = hasDevVersion(hostText);
    checks.push(
      check(
        "android-host",
        hostExists ? "pass" : "warn",
        hostExists
          ? "Gradle host detected"
          : "no Android host; Lynx Explorer remains available through dev",
        hostExists
          ? undefined
          : "run lynxship android host init --application-id <id> for a native host",
      ),
    );
    checks.push(
      check(
        "android-trace-runtime",
        hasTrace && devRuntime ? "pass" : hasTrace ? "warn" : "fail",
        hasTrace
          ? devRuntime
            ? "lynx-trace and -dev runtime detected"
            : "lynx-trace is present but no -dev Lynx dependency was detected"
          : "lynx-trace dependency not detected",
        hasTrace && devRuntime
          ? undefined
          : "use the matching Lynx -dev, lynx-trace -dev and lynx-devtool dependencies",
      ),
    );
    checks.push(
      check(
        "android-devtool-runtime",
        hasDevTool && devRuntime ? "pass" : hasDevTool ? "warn" : "fail",
        hasDevTool
          ? devRuntime
            ? "lynx-devtool and -dev runtime detected"
            : "lynx-devtool is present but no -dev Lynx dependency was detected"
          : "lynx-devtool dependency not detected",
        hasDevTool && devRuntime
          ? undefined
          : "integrate the matching Lynx DevTool development dependencies",
      ),
    );
    if (!commandExists("adb"))
      checks.push(
        check(
          "android-debug-transport",
          "warn",
          "adb not found; USB device discovery is unavailable",
          "install Android SDK Platform-Tools and connect a device",
        ),
      );
  } else {
    const podfile = await readIfExists(join(root, "ios", "Podfile"));
    const hostExists = Boolean(podfile);
    const hasTrace = hasPackageMarker(podfile, "LynxTrace");
    const hasDevTool = hasPackageMarker(podfile, "LynxDevtool");
    const devRuntime = hasDevVersion(podfile);
    checks.push(
      check(
        "ios-host",
        hostExists ? "pass" : "warn",
        hostExists
          ? "CocoaPods host detected"
          : "no iOS host; Lynx Explorer remains available through dev",
        hostExists
          ? undefined
          : "run lynxship ios host init --bundle-identifier <id> on macOS",
      ),
    );
    checks.push(
      check(
        "ios-trace-runtime",
        hasTrace && devRuntime ? "pass" : hasTrace ? "warn" : "fail",
        hasTrace
          ? devRuntime
            ? "LynxTrace and -dev runtime detected"
            : "LynxTrace is present but no -dev Lynx dependency was detected"
          : "LynxTrace dependency not detected",
        hasTrace && devRuntime
          ? undefined
          : "use the matching Lynx -dev and LynxTrace -dev pods",
      ),
    );
    checks.push(
      check(
        "ios-devtool-runtime",
        hasDevTool && devRuntime ? "pass" : hasDevTool ? "warn" : "fail",
        hasDevTool
          ? devRuntime
            ? "LynxDevtool and -dev runtime detected"
            : "LynxDevtool is present but no -dev Lynx dependency was detected"
          : "LynxDevtool dependency not detected",
        hasDevTool && devRuntime
          ? undefined
          : "integrate the matching Lynx DevTool development pods",
      ),
    );
  }

  const traceReady = checks.every(
    (item) =>
      !["android-trace-runtime", "ios-trace-runtime"].includes(item.name) ||
      item.status === "pass",
  );
  const recorderReady = traceReady;
  return {
    platform,
    checks,
    ok: checks.every((item) => item.status !== "fail"),
    traceReady,
    recorderReady,
  };
}

export function formatDevToolFailure(status: LynxDevToolStatus): string {
  return status.checks
    .filter((item) => item.status === "fail")
    .map(
      (item) =>
        `${item.name}: ${item.value}${item.fix ? ` · fix: ${item.fix}` : ""}`,
    )
    .join("; ");
}
