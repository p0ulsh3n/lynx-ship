import { homedir, platform } from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  captureProcess,
  commandExists,
  executableExists,
  runProcess,
} from "./process-runner.js";

export type ToolchainCheckStatus = "pass" | "warn" | "fail";

export interface ToolchainCheck {
  name: string;
  status: ToolchainCheckStatus;
  ok: boolean;
  value: string;
  fix?: string;
}

export interface AndroidToolchainReport {
  ok: boolean;
  checks: ToolchainCheck[];
  sdkPath?: string;
  compileSdk?: number;
  buildToolsVersion?: string;
  agpVersion?: string;
  gradleVersion?: string;
  javaVersion?: number;
  sdkPackages: string[];
}

interface AndroidProjectInputs {
  agpVersion?: string;
  compileSdk?: number;
  buildToolsVersion?: string;
  gradleVersion?: string;
}

const agpMinimumGradle: Array<[string, string]> = [
  ["9.2", "9.4.1"],
  ["9.1", "9.3.1"],
  ["9.0", "9.1.0"],
  ["8.13", "8.13"],
  ["8.12", "8.13"],
  ["8.11", "8.13"],
  ["8.10", "8.11.1"],
  ["8.9", "8.11.1"],
  ["8.8", "8.10.2"],
  ["8.7", "8.9"],
  ["8.6", "8.7"],
  ["8.5", "8.7"],
  ["8.4", "8.6"],
  ["8.3", "8.4"],
  ["8.2", "8.2"],
  ["8.1", "8.0"],
  ["8.0", "8.0"],
  ["7.4", "7.5"],
  ["7.3", "7.4"],
  ["7.2", "7.3.3"],
  ["7.1", "7.2"],
  ["7.0", "7.0"],
];

function readProjectFiles(root: string): string {
  const files = [
    "android/build.gradle",
    "android/build.gradle.kts",
    "android/settings.gradle",
    "android/settings.gradle.kts",
    "android/app/build.gradle",
    "android/app/build.gradle.kts",
    "android/gradle/libs.versions.toml",
  ];
  return files
    .filter((file) => existsSync(join(root, file)))
    .map((file) => readFileSync(join(root, file), "utf8"))
    .join("\n");
}

function readWrapperVersion(root: string): string | undefined {
  const file = join(
    root,
    "android",
    "gradle",
    "wrapper",
    "gradle-wrapper.properties",
  );
  if (!existsSync(file)) return undefined;
  const content = readFileSync(file, "utf8");
  return content.match(
    /gradle-([0-9]+(?:\.[0-9]+){1,2})-(?:bin|all)\.zip/,
  )?.[1];
}

function readAndroidInputs(root: string): AndroidProjectInputs {
  const content = readProjectFiles(root);
  const agpVersion =
    content.match(
      /com\.android\.(?:application|library)["']?\)?\s+version\s+["']([0-9]+(?:\.[0-9]+){1,2})["']/,
    )?.[1] ??
    content.match(
      /com\.android\.tools\.build:gradle:([0-9]+(?:\.[0-9]+){1,2})/,
    )?.[1];
  const compileSdk = content.match(
    /compileSdk(?:Version)?\s*(?:=|\s)\s*["']?(\d+)/,
  )?.[1];
  const buildToolsVersion = content.match(
    /buildToolsVersion\s*(?:=|\s)\s*["']([^"']+)["']/,
  )?.[1];
  return {
    agpVersion,
    compileSdk: compileSdk ? Number(compileSdk) : undefined,
    buildToolsVersion,
    gradleVersion: readWrapperVersion(root),
  };
}

function versionParts(version: string): number[] {
  return version.split(".").map((part) => Number(part) || 0);
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function requiredGradleForAgp(agp?: string): string | undefined {
  if (!agp) return undefined;
  return agpMinimumGradle.find(
    ([minimum]) => compareVersions(agp, minimum) >= 0,
  )?.[1];
}

function requiredJavaForAgp(agp?: string): number {
  if (!agp) return 17;
  if (compareVersions(agp, "8.0") >= 0) return 17;
  if (compareVersions(agp, "7.0") >= 0) return 11;
  return 8;
}

function sdkCandidates(): string[] {
  const values = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME];
  if (platform() === "win32") {
    values.push(
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "Android", "Sdk")
        : undefined,
    );
  } else if (platform() === "darwin") {
    values.push(join(homedir(), "Library", "Android", "sdk"));
  } else {
    values.push(join(homedir(), "Android", "Sdk"));
  }
  return [
    ...new Set(
      values.filter((value): value is string => Boolean(value)).map(normalize),
    ),
  ];
}

function sdkExecutable(sdkPath: string, name: string): string | undefined {
  const extension = platform() === "win32" ? ".exe" : "";
  const candidates = [
    join(sdkPath, "platform-tools", `${name}${extension}`),
    ...readDirectories(join(sdkPath, "build-tools")).map((version) =>
      join(sdkPath, "build-tools", version, `${name}${extension}`),
    ),
  ];
  return candidates.find(executableExists);
}

function readDirectories(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function sdkManagerPath(sdkPath: string): string | undefined {
  const extension = platform() === "win32" ? ".bat" : "";
  const candidates = [
    join(sdkPath, "cmdline-tools", "latest", "bin", `sdkmanager${extension}`),
    ...readDirectories(join(sdkPath, "cmdline-tools"))
      .filter((name) => name !== "latest")
      .map((name) =>
        join(sdkPath, "cmdline-tools", name, "bin", `sdkmanager${extension}`),
      ),
    join(sdkPath, "tools", "bin", `sdkmanager${extension}`),
  ];
  return (
    candidates.find(executableExists) ??
    (commandExists("sdkmanager") ? "sdkmanager" : undefined)
  );
}

async function javaVersion(
  javaPath: string,
  cwd: string,
): Promise<number | undefined> {
  try {
    const result = await captureProcess(javaPath, ["-version"], { cwd });
    const output = `${result.stdout}\n${result.stderr}`;
    const match = output.match(/version\s+["'](\d+)(?:\.(\d+))?/i);
    if (!match) return undefined;
    return Number(match[1]) === 1 ? Number(match[2]) : Number(match[1]);
  } catch {
    return undefined;
  }
}

function javaCandidates(): string[] {
  const executable = platform() === "win32" ? "java.exe" : "java";
  const values = [
    process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, "bin", executable)
      : undefined,
    commandExists("java") ? "java" : undefined,
    platform() === "win32"
      ? join(
          process.env.LOCALAPPDATA ?? "",
          "Programs",
          "Android",
          "Android Studio",
          "jbr",
          "bin",
          executable,
        )
      : undefined,
    platform() === "win32"
      ? join(
          process.env.PROGRAMFILES ?? "",
          "Android",
          "Android Studio",
          "jbr",
          "bin",
          executable,
        )
      : undefined,
    platform() === "win32"
      ? join(
          process.env.PROGRAMFILES ?? "",
          "Java",
          "jdk-17",
          "bin",
          executable,
        )
      : undefined,
    platform() === "win32"
      ? join(
          process.env.PROGRAMFILES ?? "",
          "Eclipse Adoptium",
          "jdk-17",
          "bin",
          executable,
        )
      : undefined,
    platform() === "darwin"
      ? "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java"
      : undefined,
    platform() === "darwin"
      ? "/Applications/Android Studio.app/Contents/jre/Contents/Home/bin/java"
      : undefined,
    platform() === "linux" ? "/opt/android-studio/jbr/bin/java" : undefined,
    platform() === "linux"
      ? join(homedir(), "android-studio", "jbr", "bin", "java")
      : undefined,
  ];
  return values.filter((value): value is string => Boolean(value));
}

function check(
  name: string,
  status: ToolchainCheckStatus,
  value: string,
  fix?: string,
): ToolchainCheck {
  return { name, status, ok: status !== "fail", value, fix };
}

export async function inspectAndroidToolchain(
  root: string,
): Promise<AndroidToolchainReport> {
  const inputs = readAndroidInputs(root);
  const checks: ToolchainCheck[] = [];
  const wrapper = join(
    root,
    "android",
    platform() === "win32" ? "gradlew.bat" : "gradlew",
  );
  const wrapperExists =
    existsSync(wrapper) &&
    (platform() === "win32" || executableExists(wrapper));
  checks.push(
    check(
      "gradle-wrapper",
      wrapperExists ? "pass" : "fail",
      wrapperExists
        ? inputs.gradleVersion
          ? `Gradle ${inputs.gradleVersion}`
          : "found · version unknown"
        : "missing",
      wrapperExists
        ? undefined
        : "lynxship android host init --application-id com.example.myapp",
    ),
  );

  const minimumGradle = requiredGradleForAgp(inputs.agpVersion);
  const gradleCompatible = Boolean(
    inputs.gradleVersion &&
    minimumGradle &&
    compareVersions(inputs.gradleVersion, minimumGradle) >= 0,
  );
  const gradleStatus =
    !inputs.gradleVersion || !inputs.agpVersion
      ? "warn"
      : gradleCompatible
        ? "pass"
        : "fail";
  checks.push(
    check(
      "agp-gradle-compatibility",
      gradleStatus,
      inputs.agpVersion && inputs.gradleVersion
        ? `AGP ${inputs.agpVersion} · Gradle ${inputs.gradleVersion}${minimumGradle ? ` · minimum Gradle ${minimumGradle}` : ""}`
        : "AGP or wrapper version not detected",
      gradleStatus === "fail" && minimumGradle
        ? `Update the project wrapper to Gradle ${minimumGradle}; do not use a global Gradle installation`
        : undefined,
    ),
  );

  const requiredJava = requiredJavaForAgp(inputs.agpVersion);
  let detectedJava: number | undefined;
  let javaPath: string | undefined;
  for (const candidate of javaCandidates()) {
    const version = await javaVersion(candidate, root);
    if (version !== undefined) {
      detectedJava = version;
      javaPath = candidate;
      break;
    }
  }
  const javaStatus =
    detectedJava === undefined
      ? "fail"
      : detectedJava >= requiredJava
        ? "pass"
        : "fail";
  checks.push(
    check(
      "java",
      javaStatus,
      detectedJava === undefined
        ? "missing"
        : `JDK ${detectedJava}${javaPath === "java" ? " · PATH" : ""}`,
      javaStatus === "fail"
        ? `Install/configure JDK ${requiredJava} and set JAVA_HOME, then run lynxship doctor --platform android`
        : undefined,
    ),
  );

  const sdkPath = sdkCandidates().find((candidate) => existsSync(candidate));
  const compileSdk = inputs.compileSdk;
  const buildTools = inputs.buildToolsVersion;
  const platformPackage = compileSdk
    ? `platforms;android-${compileSdk}`
    : undefined;
  const buildToolsPackage = buildTools
    ? `build-tools;${buildTools}`
    : undefined;
  const missingPackages = [
    platformPackage &&
    sdkPath &&
    !existsSync(join(sdkPath, "platforms", `android-${compileSdk}`))
      ? platformPackage
      : undefined,
    buildTools &&
    sdkPath &&
    !existsSync(join(sdkPath, "build-tools", buildTools))
      ? buildToolsPackage
      : undefined,
  ].filter((value): value is string => Boolean(value));
  const sdkStatus = !sdkPath
    ? "fail"
    : missingPackages.length
      ? "fail"
      : "pass";
  checks.push(
    check(
      "android-sdk",
      sdkStatus,
      !sdkPath
        ? "missing · set ANDROID_HOME or ANDROID_SDK_ROOT"
        : missingPackages.length
          ? `missing: ${missingPackages.join(", ")}`
          : sdkPath,
      sdkStatus === "fail"
        ? "Install Android Studio or the Android command-line tools, then run lynxship doctor --platform android --fix"
        : undefined,
    ),
  );

  const manager = sdkPath ? sdkManagerPath(sdkPath) : undefined;
  checks.push(
    check(
      "sdkmanager",
      manager ? "pass" : sdkPath ? "warn" : "fail",
      manager
        ? "available"
        : sdkPath
          ? "missing · use Android Studio SDK Manager"
          : "unavailable until Android SDK is installed",
      manager && missingPackages.length
        ? `sdkmanager ${missingPackages.map((value) => `"${value}"`).join(" ")}`
        : undefined,
    ),
  );

  const adb = sdkPath ? sdkExecutable(sdkPath, "adb") : undefined;
  checks.push(
    check(
      "adb",
      adb || commandExists("adb") ? "pass" : "warn",
      adb || commandExists("adb")
        ? "Android Platform-Tools available"
        : "missing · required for lynxship run/logs",
      !adb && !commandExists("adb")
        ? "Install Android SDK Platform-Tools, then run adb devices"
        : undefined,
    ),
  );
  const apksigner = sdkPath ? sdkExecutable(sdkPath, "apksigner") : undefined;
  checks.push(
    check(
      "apksigner",
      apksigner || commandExists("apksigner") ? "pass" : "warn",
      apksigner || commandExists("apksigner")
        ? "Android Build Tools available"
        : "missing · required to verify APK signatures",
      !apksigner && !commandExists("apksigner")
        ? "Install Android SDK Build Tools, then run lynxship doctor --platform android"
        : undefined,
    ),
  );
  checks.push(
    check(
      "android-sdk-licenses",
      sdkPath && existsSync(join(sdkPath, "licenses")) ? "pass" : "warn",
      sdkPath && existsSync(join(sdkPath, "licenses"))
        ? "license directory found"
        : "not verified",
      sdkPath ? "sdkmanager --licenses" : undefined,
    ),
  );

  const failures = checks.filter((item) => item.status === "fail");
  return {
    ok: failures.length === 0,
    checks,
    sdkPath,
    compileSdk,
    buildToolsVersion: buildTools,
    agpVersion: inputs.agpVersion,
    gradleVersion: inputs.gradleVersion,
    javaVersion: detectedJava,
    sdkPackages: missingPackages,
  };
}

export async function fixAndroidToolchain(
  root: string,
  report: AndroidToolchainReport,
  confirm: (message: string) => Promise<boolean>,
  onOutput?: (line: string) => void,
): Promise<void> {
  const managerCheck = report.checks.find((item) => item.name === "sdkmanager");
  const manager = report.sdkPath ? sdkManagerPath(report.sdkPath) : undefined;
  if (!manager || !report.sdkPackages.length) return;
  const packages = report.sdkPackages;
  if (
    !(await confirm(
      `Install missing Android SDK packages (${packages.join(", ")}) now?`,
    ))
  )
    return;
  await runProcess(manager, packages, { cwd: root, onOutput });
  if (managerCheck && !(await confirm("Accept Android SDK licenses now?")))
    return;
  await runProcess(manager, ["--licenses"], { cwd: root, onOutput });
}

export function formatAndroidToolchainFailure(
  report: AndroidToolchainReport,
): string {
  return report.checks
    .filter((item) => item.status === "fail")
    .map(
      (item) =>
        `${item.name}: ${item.value}${item.fix ? ` · fix: ${item.fix}` : ""}`,
    )
    .join("; ");
}
