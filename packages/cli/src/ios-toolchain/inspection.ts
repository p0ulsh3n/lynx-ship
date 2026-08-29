import { platform } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BuildProfile } from "../config.js";
import { captureProcess, commandExists } from "../process-runner.js";

import type {
  IosBuildTarget,
  IosToolchainCheck,
  IosToolchainReport,
} from "./types.js";
import {
  check,
  commandOutput,
  findHost,
  hasValidProvisioningProfile,
  projectFlag,
  probeCommand,
  probeProject,
  probeVersion,
  setting,
} from "./probes.js";

export async function inspectIosToolchain(
  root: string,
  profile: BuildProfile,
  target: IosBuildTarget = "device",
): Promise<IosToolchainReport> {
  const checks: IosToolchainCheck[] = [];
  const isMac = platform() === "darwin";
  const host = findHost(root, profile);
  const hostExists = Boolean(host && existsSync(host));
  const scheme = profile.ios?.scheme;
  const simulator = target === "simulator";
  const exportOptions = profile.ios?.exportOptionsPlist
    ? resolve(root, profile.ios.exportOptionsPlist)
    : undefined;

  checks.push(
    check(
      "ios-platform",
      isMac ? "pass" : "fail",
      isMac
        ? "macOS"
        : `${platform()} · macOS is required for an iOS ${simulator ? "Simulator app" : "IPA"}`,
      isMac
        ? undefined
        : "Run the iOS build on a macOS machine or macOS CI runner",
    ),
  );

  if (!isMac) {
    checks.push(
      check(
        "ios-host",
        "warn",
        hostExists
          ? "host found but not inspectable on this OS"
          : "not inspected",
      ),
    );
    return {
      ok: checks.every((item) => item.status !== "fail"),
      checks,
      project: host,
      scheme,
      automaticSigning: false,
    };
  }

  const developerDirectory = await probeVersion("xcode-select", ["-p"], root);
  checks.push(
    check(
      "xcode-select",
      developerDirectory ? "pass" : "fail",
      developerDirectory ?? "no active Xcode developer directory",
      developerDirectory
        ? undefined
        : "sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer",
    ),
  );

  const xcodeVersion = await probeVersion("xcodebuild", ["-version"], root);
  checks.push(
    check(
      "xcode",
      xcodeVersion ? "pass" : "fail",
      xcodeVersion ?? "xcodebuild unavailable",
      xcodeVersion
        ? undefined
        : "Install Xcode, open it once, accept its license, then run xcode-select --install if needed",
    ),
  );
  checks.push(
    check(
      "xcrun",
      commandExists("xcrun") ? "pass" : "fail",
      commandExists("xcrun") ? "available" : "missing",
      commandExists("xcrun")
        ? undefined
        : "Install Xcode and select its command-line tools",
    ),
  );
  checks.push(
    check(
      "codesign",
      commandExists("codesign") ? "pass" : "fail",
      commandExists("codesign") ? "available" : "missing",
      commandExists("codesign")
        ? undefined
        : "Install Xcode command-line tools",
    ),
  );
  checks.push(
    check(
      "unzip",
      commandExists("unzip") ? "pass" : "fail",
      commandExists("unzip") ? "available" : "missing",
      commandExists("unzip")
        ? undefined
        : "Install the macOS command-line tools",
    ),
  );

  checks.push(
    check(
      "ios-host",
      hostExists ? "pass" : "fail",
      hostExists ? host! : "Xcode project or workspace not found",
      hostExists
        ? undefined
        : "lynxship ios host init --bundle-identifier com.example.myapp",
    ),
  );
  checks.push(
    check(
      "ios-scheme",
      scheme ? "pass" : "fail",
      scheme ?? "missing from the selected build profile",
      scheme ? undefined : "Set ios.scheme in the selected build profile",
    ),
  );

  const context = await probeProject(
    root,
    {
      path: hostExists ? host : undefined,
      flag: host ? projectFlag(host) : "-project",
      scheme,
    },
    profile,
    target,
  );
  const settingsOutput = context.settings
    ? commandOutput(context.settings)
    : "";
  checks.push(
    check(
      "xcode-project-settings",
      !context.settings
        ? "warn"
        : context.settings.code === 0
          ? "pass"
          : "fail",
      !context.settings
        ? "not inspected until host and scheme are configured"
        : context.settings.code === 0
          ? "scheme and configuration load successfully"
          : "xcodebuild could not load the selected scheme",
      context.settings?.code === 0 || !context.settings
        ? undefined
        : "Open the project in Xcode and verify the scheme is shared and buildable",
    ),
  );

  const automaticSigning =
    setting(settingsOutput, "CODE_SIGN_STYLE") === "Automatic";
  const team = setting(settingsOutput, "DEVELOPMENT_TEAM");
  checks.push(
    check(
      "apple-team",
      simulator
        ? "pass"
        : context.settings?.code !== 0 || !context.settings
          ? "warn"
          : team
            ? "pass"
            : "fail",
      simulator
        ? "not required for iOS Simulator"
        : (team ?? "team not resolved from Xcode build settings"),
      simulator || team
        ? undefined
        : "Select the Apple Developer Team in Xcode Signing & Capabilities",
    ),
  );

  const distribution =
    profile.distribution ?? profile.ios?.distribution ?? "store";
  const identityResult = simulator
    ? undefined
    : await (commandExists("security")
        ? captureProcess(
            "security",
            ["find-identity", "-v", "-p", "codesigning"],
            {
              cwd: root,
            },
          )
        : undefined);
  const identityOutput = identityResult ? commandOutput(identityResult) : "";
  const identityCount = Number(
    identityOutput.match(/(\d+) valid identities found/)?.[1] ?? 0,
  );
  const requiredIdentity =
    distribution === "store" ? "Apple Distribution" : "Apple Development";
  checks.push(
    check(
      "apple-signing-identity",
      simulator
        ? "pass"
        : identityCount === 0 || !identityOutput.includes(requiredIdentity)
          ? "fail"
          : "pass",
      simulator
        ? "not required for iOS Simulator"
        : identityCount === 0
          ? "no valid code-signing identity found"
          : identityOutput.includes(requiredIdentity)
            ? `${requiredIdentity} identity available`
            : `${requiredIdentity} identity not found`,
      simulator ||
        (identityCount > 0 && identityOutput.includes(requiredIdentity))
        ? undefined
        : "Install or select the Apple certificate in Xcode Settings > Accounts, then rerun doctor",
    ),
  );

  const podfile = join(root, "ios", "Podfile");
  const podRequired = existsSync(podfile);
  const podVersion = podRequired
    ? await probeVersion("pod", ["--version"], root)
    : undefined;
  checks.push(
    check(
      "cocoapods",
      !podRequired || podVersion ? "pass" : "fail",
      !podRequired
        ? "not required · no ios/Podfile"
        : (podVersion ?? "Podfile found but pod is unavailable"),
      !podRequired || podVersion
        ? undefined
        : "gem install cocoapods, then run pod install in the project",
    ),
  );

  let exportOptionsContent: string | undefined;
  if (exportOptions && existsSync(exportOptions)) {
    try {
      exportOptionsContent = readFileSync(exportOptions, "utf8");
    } catch {
      exportOptionsContent = undefined;
    }
  }
  const exportMethod = exportOptionsContent?.match(
    /<key>method<\/key>\s*<string>([^<]+)<\/string>/,
  )?.[1];
  const supportedExportMethods = new Set([
    "app-store",
    "ad-hoc",
    "development",
    "enterprise",
  ]);
  checks.push(
    check(
      "export-options",
      simulator
        ? "pass"
        : !exportOptions
          ? "fail"
          : !existsSync(exportOptions)
            ? "fail"
            : !exportMethod || !supportedExportMethods.has(exportMethod)
              ? "fail"
              : "pass",
      simulator
        ? "not required for iOS Simulator"
        : !exportOptions
          ? "missing from the production build profile"
          : !existsSync(exportOptions)
            ? `${exportOptions} not found`
            : exportMethod && supportedExportMethods.has(exportMethod)
              ? `method: ${exportMethod}`
              : "method missing or invalid for an iOS export",
      simulator ||
        (exportOptions &&
          existsSync(exportOptions) &&
          exportMethod &&
          supportedExportMethods.has(exportMethod))
        ? undefined
        : "Set build.production.ios.exportOptionsPlist to a valid ExportOptions.plist",
    ),
  );

  const manualProvisioning =
    setting(settingsOutput, "CODE_SIGN_STYLE") === "Manual" ||
    exportOptionsContent?.includes("<key>provisioningProfiles</key>") === true;
  const profilesAvailable = await hasValidProvisioningProfile(
    root,
    setting(settingsOutput, "PRODUCT_BUNDLE_IDENTIFIER"),
  );
  checks.push(
    check(
      "ios-provisioning",
      simulator
        ? "pass"
        : manualProvisioning && !profilesAvailable
          ? "fail"
          : automaticSigning && !profilesAvailable
            ? "warn"
            : "pass",
      simulator
        ? "not required for iOS Simulator"
        : manualProvisioning && !profilesAvailable
          ? "manual signing selected but no local provisioning profile was found"
          : automaticSigning && !profilesAvailable
            ? "Xcode-managed provisioning will be requested during the build"
            : profilesAvailable
              ? "local provisioning profile available"
              : "not required by the detected signing mode",
      simulator || !(manualProvisioning && !profilesAvailable)
        ? undefined
        : "Download a matching .mobileprovision/.provisionprofile from Apple Developer and install it in Xcode",
    ),
  );

  const simctlAvailable = await probeCommand(
    "xcrun",
    ["--find", "simctl"],
    root,
  );
  const devicectlAvailable = await probeCommand(
    "xcrun",
    ["--find", "devicectl"],
    root,
  );
  checks.push(
    check(
      "ios-device-tools",
      simctlAvailable || devicectlAvailable ? "pass" : "warn",
      simctlAvailable && devicectlAvailable
        ? "simctl and devicectl available"
        : simctlAvailable
          ? "simctl available · devicectl unavailable"
          : devicectlAvailable
            ? "devicectl available · simctl unavailable"
            : "simctl and devicectl unavailable",
      simctlAvailable || devicectlAvailable
        ? undefined
        : "Install the full Xcode toolchain, then rerun lynxship doctor --platform ios",
    ),
  );
  if (simulator) {
    const runtimeResult = await (commandExists("xcrun")
      ? captureProcess("xcrun", ["simctl", "list", "runtimes"], { cwd: root })
      : undefined);
    const runtimeOutput = runtimeResult ? commandOutput(runtimeResult) : "";
    const hasRuntime = /iOS\s+[0-9]/.test(runtimeOutput);
    checks.push(
      check(
        "ios-simulator-runtime",
        hasRuntime ? "pass" : "fail",
        hasRuntime
          ? "iOS Simulator runtime available"
          : "no iOS Simulator runtime found",
        hasRuntime
          ? undefined
          : "Open Xcode > Settings > Components and install an iOS Simulator runtime",
      ),
    );
  }

  const failures = checks.filter((item) => item.status === "fail");
  return {
    ok: failures.length === 0,
    checks,
    project: host,
    scheme,
    automaticSigning,
  };
}
