export type DesktopTarget =
  | "macos-arm64"
  | "macos-x64"
  | "windows-x64"
  | "linux-x64"
  | "linux-arm64";

export interface LynxtronArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly target: DesktopTarget;
}

export interface LynxtronHost {
  readonly target: DesktopTarget;
  readonly runtimeVersion: string;
  readonly loadBundle: (path: string) => Promise<void>;
}

export interface LynxtronLoadPlan {
  readonly artifact: LynxtronArtifact;
  readonly target: DesktopTarget;
  readonly verified: boolean;
}
