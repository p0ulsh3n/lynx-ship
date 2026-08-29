import type { BuildJob } from "@lynxship/contracts";

export interface AndroidWorkerCheck {
  readonly name: "host" | "java" | "gradle-wrapper" | "android-sdk";
  readonly available: boolean;
  readonly detail: string;
}

export interface AndroidWorkerEnvironment {
  readonly platform: NodeJS.Platform;
  readonly checks: readonly AndroidWorkerCheck[];
  readonly ready: boolean;
}

export interface AndroidBuildRequest {
  readonly job: BuildJob;
  readonly projectRoot: string;
  readonly task: "assembleDebug" | "assembleRelease" | "bundleRelease";
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

export class AndroidWorkerError extends Error {
  readonly code:
    | "ANDROID_WORKER_NOT_READY"
    | "ANDROID_REQUEST_INVALID"
    | "ANDROID_BUILD_FAILED"
    | "ANDROID_ARTIFACT_REQUIRED"
    | "ANDROID_ARTIFACT_MISSING";

  constructor(code: AndroidWorkerError["code"], message: string) {
    super(message);
    this.name = "AndroidWorkerError";
    this.code = code;
  }
}
