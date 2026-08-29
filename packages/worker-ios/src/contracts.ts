import type { BuildJob } from "@lynxship/contracts";

export interface IosWorkerCheck {
  readonly name: "host" | "xcodebuild" | "xcrun";
  readonly available: boolean;
  readonly detail: string;
}

export interface IosWorkerEnvironment {
  readonly platform: NodeJS.Platform;
  readonly checks: readonly IosWorkerCheck[];
  readonly ready: boolean;
}

export interface IosBuildRequest {
  readonly job: BuildJob;
  readonly projectRoot: string;
  readonly projectFile: string;
  readonly scheme: string;
  readonly configuration: "Debug" | "Release";
  readonly sdk: "iphoneos" | "iphonesimulator";
  readonly artifactPath: string;
  readonly args?: readonly string[];
}

export interface WorkerCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type WorkerCommandRunner = (
  executable: string,
  args: readonly string[],
  cwd: string,
) => Promise<WorkerCommandResult>;

export class IosWorkerError extends Error {
  readonly code:
    | "IOS_WORKER_NOT_READY"
    | "IOS_REQUEST_INVALID"
    | "IOS_BUILD_FAILED"
    | "IOS_ARTIFACT_REQUIRED"
    | "IOS_ARTIFACT_MISSING";

  constructor(code: IosWorkerError["code"], message: string) {
    super(message);
    this.name = "IosWorkerError";
    this.code = code;
  }
}
