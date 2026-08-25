import { homedir, platform } from "node:os";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BuildProfile } from "./config.js";
import {
  captureProcess,
  commandExists,
  type CapturedProcessResult,
} from "./process-runner.js";

export type IosToolchainStatus = "pass" | "warn" | "fail";

export interface IosToolchainCheck {
  name: string;
  status: IosToolchainStatus;
  ok: boolean;
  value: string;
  fix?: string;
}

export interface IosToolchainReport {
  ok: boolean;
  checks: IosToolchainCheck[];
  project?: string;
  scheme?: string;
  automaticSigning: boolean;
}

interface ProjectContext {
  path?: string;
  flag: "-workspace" | "-project";
  scheme?: string;
  settings?: CapturedProcessResult;
}

function check(
  name: string,
  status: IosToolchainStatus,
  value: string,
  fix?: string,
): IosToolchainCheck {
  return { name, status, ok: status !== "fail", value, fix };
}

function findHost(root: string, profile: BuildProfile): string | undefined {
  const configured = profile.ios?.workspace ?? profile.ios?.project;
  if (configured) {
    const configuredPath = resolve(root, configured);
    if (configuredPath.endsWith(".xcodeproj")) {
      const workspace = configuredPath.replace(/\.xcodeproj$/, ".xcworkspace");
      if (existsSync(workspace)) return workspace;
    }
    return configuredPath;
  }
  for (const directory of ["ios", "macos"]) {
    try {
      const candidate = readdirSync(join(root, directory)).find(
        (name) => name.endsWith(".xcworkspace") || name.endsWith(".xcodeproj"),
      );
      if (candidate) return join(root, directory, candidate);
    } catch {
      // A native host is optional until an iOS build is requested.
    }
  }
  return undefined;
}

function projectFlag(path: string): "-workspace" | "-project" {
  return path.endsWith(".xcworkspace") ? "-workspace" : "-project";
}

function commandOutput(result: CapturedProcessResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function setting(output: string, name: string): string | undefined {
  return output.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim();
}

function provisioningProfilesDirectory(): string {
  return join(homedir(), "Library", "MobileDevice", "Provisioning Profiles");
}

function provisioningProfileFiles(): string[] {
  try {
    return readdirSync(provisioningProfilesDirectory())
      .filter((name) => /\.(?:mobileprovision|provisionprofile)$/.test(name))
      .map((name) => join(provisioningProfilesDirectory(), name));
  } catch {
    return [];
  }
}

function plistValue(content: string, key: string): string | undefined {
  return content.match(
    new RegExp(`<key>${key}</key>\\s*<(?:string|date)>([^<]+)</`),
  )?.[1];
}

async function validProvisioningProfile(
  file: string,
  root: string,
  bundleIdentifier?: string,
): Promise<boolean> {
  if (!commandExists("security")) return false;
  try {
    const decoded = await captureProcess(
      "security",
      ["cms", "-D", "-i", file],
      { cwd: root },
    );
    if (decoded.code !== 0) return false;
    const content = commandOutput(decoded);
    const expiration = plistValue(content, "ExpirationDate");
    if (!expiration || Number.isNaN(Date.parse(expiration))) return false;
    if (Date.parse(expiration) <= Date.now()) return false;
    if (!bundleIdentifier) return true;
    const applicationIdentifier = plistValue(content, "application-identifier");
    if (!applicationIdentifier) return false;
    const profileBundle = applicationIdentifier.split(".").slice(1).join(".");
    return profileBundle === bundleIdentifier || profileBundle === "*";
  } catch {
    return false;
  }
}

async function hasValidProvisioningProfile(
  root: string,
  bundleIdentifier: string | undefined,
): Promise<boolean> {
  const files = provisioningProfileFiles();
  for (const file of files) {
    if (await validProvisioningProfile(file, root, bundleIdentifier))
      return true;
  }
  return false;
}

async function probeProject(
  root: string,
  context: ProjectContext,
  profile: BuildProfile,
): Promise<ProjectContext> {
  if (!context.path || !context.scheme || !commandExists("xcodebuild"))
    return context;
  const configuration = profile.ios?.configuration ?? "Release";
  const settings = await captureProcess(
    "xcodebuild",
    [
      context.flag,
      context.path,
      "-scheme",
      context.scheme,
      "-configuration",
      configuration,
      "-showBuildSettings",
    ],
    { cwd: root },
  );
  return { ...context, settings };
}

async function probeVersion(
  command: string,
  args: string[],
  cwd: string,
): Promise<string | undefined> {
  if (!commandExists(command)) return undefined;
  try {
    const result = await captureProcess(command, args, { cwd });
    if (result.code !== 0) return undefined;
    return commandOutput(result).split(/\r?\n/)[0]?.trim();
  } catch {
    return undefined;
  }
}

async function probeCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<boolean> {
  if (!commandExists(command)) return false;
  try {
    return (await captureProcess(command, args, { cwd })).code === 0;
  } catch {
    return false;
  }
}

export async function inspectIosToolchain(
  root: string,
  profile: BuildProfile,
): Promise<IosToolchainReport> {
  const checks: IosToolchainCheck[] = [];
  const isMac = platform() === "darwin";
  const host = findHost(root, profile);
  const hostExists = Boolean(host && existsSync(host));
  const scheme = profile.ios?.scheme;
  const exportOptions = profile.ios?.exportOptionsPlist
    ? resolve(root, profile.ios.exportOptionsPlist)
    : undefined;

  checks.push(
    check(
      "ios-platform",
      isMac ? "pass" : "fail",
      isMac ? "macOS" : `${platform()} · macOS is required for an IPA`,
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
      scheme ?? "missing from the production build profile",
      scheme ? undefined : "Set build.production.ios.scheme in lynxship.json",
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
      context.settings?.code !== 0 || !context.settings
        ? "warn"
        : team
          ? "pass"
          : "fail",
      team ?? "team not resolved from Xcode build settings",
      team
        ? undefined
        : "Select the Apple Developer Team in Xcode Signing & Capabilities",
    ),
  );

  const distribution =
    profile.distribution ?? profile.ios?.distribution ?? "store";
  const identityResult = await (commandExists("security")
    ? captureProcess("security", ["find-identity", "-v", "-p", "codesigning"], {
        cwd: root,
      })
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
      identityCount === 0 || !identityOutput.includes(requiredIdentity)
        ? "fail"
        : "pass",
      identityCount === 0
        ? "no valid code-signing identity found"
        : identityOutput.includes(requiredIdentity)
          ? `${requiredIdentity} identity available`
          : `${requiredIdentity} identity not found`,
      identityCount > 0 && identityOutput.includes(requiredIdentity)
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
      !exportOptions
        ? "fail"
        : !existsSync(exportOptions)
          ? "fail"
          : !exportMethod || !supportedExportMethods.has(exportMethod)
            ? "fail"
            : "pass",
      !exportOptions
        ? "missing from the production build profile"
        : !existsSync(exportOptions)
          ? `${exportOptions} not found`
          : exportMethod && supportedExportMethods.has(exportMethod)
            ? `method: ${exportMethod}`
            : "method missing or invalid for an iOS export",
      exportOptions &&
        existsSync(exportOptions) &&
        exportMethod &&
        supportedExportMethods.has(exportMethod)
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
      manualProvisioning && !profilesAvailable
        ? "fail"
        : automaticSigning && !profilesAvailable
          ? "warn"
          : "pass",
      manualProvisioning && !profilesAvailable
        ? "manual signing selected but no local provisioning profile was found"
        : automaticSigning && !profilesAvailable
          ? "Xcode-managed provisioning will be requested during the build"
          : profilesAvailable
            ? "local provisioning profile available"
            : "not required by the detected signing mode",
      manualProvisioning && !profilesAvailable
        ? "Download a matching .mobileprovision/.provisionprofile from Apple Developer and install it in Xcode"
        : undefined,
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

  const failures = checks.filter((item) => item.status === "fail");
  return {
    ok: failures.length === 0,
    checks,
    project: host,
    scheme,
    automaticSigning,
  };
}

export function formatIosToolchainFailure(report: IosToolchainReport): string {
  return report.checks
    .filter((item) => item.status === "fail")
    .map(
      (item) =>
        `${item.name}: ${item.value}${item.fix ? ` · fix: ${item.fix}` : ""}`,
    )
    .join("; ");
}
