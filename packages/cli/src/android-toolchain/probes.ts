import { homedir, platform } from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  captureProcess,
  commandExists,
  executableExists,
} from "../process-runner.js";
import type { ToolchainCheck, ToolchainCheckStatus } from "./types.js";

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

export function readProjectFiles(root: string): string {
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

export function readWrapperVersion(root: string): string | undefined {
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

export function readAndroidInputs(root: string): AndroidProjectInputs {
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

export function versionParts(version: string): number[] {
  return version.split(".").map((part) => Number(part) || 0);
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function requiredGradleForAgp(agp?: string): string | undefined {
  if (!agp) return undefined;
  return agpMinimumGradle.find(
    ([minimum]) => compareVersions(agp, minimum) >= 0,
  )?.[1];
}

export function requiredJavaForAgp(agp?: string): number {
  if (!agp) return 17;
  if (compareVersions(agp, "8.0") >= 0) return 17;
  if (compareVersions(agp, "7.0") >= 0) return 11;
  return 8;
}

export function sdkCandidates(): string[] {
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

export function sdkExecutable(
  sdkPath: string,
  name: string,
): string | undefined {
  const extension = platform() === "win32" ? ".exe" : "";
  const candidates = [
    join(sdkPath, "platform-tools", `${name}${extension}`),
    ...readDirectories(join(sdkPath, "build-tools")).map((version) =>
      join(sdkPath, "build-tools", version, `${name}${extension}`),
    ),
  ];
  return candidates.find(executableExists);
}

export function readDirectories(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

export function sdkManagerPath(sdkPath: string): string | undefined {
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

export async function javaVersion(
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

export function javaCandidates(): string[] {
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

export function check(
  name: string,
  status: ToolchainCheckStatus,
  value: string,
  fix?: string,
): ToolchainCheck {
  return { name, status, ok: status !== "fail", value, fix };
}
