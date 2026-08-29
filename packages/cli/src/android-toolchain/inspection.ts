import { platform } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commandExists, executableExists } from "../process-runner.js";
import type { AndroidToolchainReport, ToolchainCheck } from "./types.js";
import {
  check,
  compareVersions,
  javaCandidates,
  javaVersion,
  readAndroidInputs,
  requiredGradleForAgp,
  requiredJavaForAgp,
  sdkCandidates,
  sdkManagerPath,
  sdkExecutable,
} from "./probes.js";

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
