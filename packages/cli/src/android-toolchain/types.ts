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
