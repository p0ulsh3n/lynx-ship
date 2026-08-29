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

export type IosBuildTarget = "device" | "simulator";
