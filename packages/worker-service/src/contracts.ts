import type {
  BuildJob,
  BuildSourceReference,
  BuildResult,
  BuildState,
  Platform,
  Worker,
} from "@lynxship/contracts";
import type { SourceSnapshot } from "@lynxship/build-orchestrator";
import type { RedisQueue } from "@lynxship/queue";

/** Immutable identity carried in a Redis build message. */
export interface BuildWorkItem {
  readonly schemaVersion: 1;
  readonly buildId: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly platform: Platform;
  readonly profile: string;
  readonly sourceHash: string | null;
  readonly source?: BuildSourceReference;
}

export interface WorkerReportRequest {
  readonly workerId: string;
  readonly buildId: string;
  readonly reportId: string;
  readonly report: {
    readonly state: BuildState;
    readonly reason?: string;
    readonly log?: { readonly level: string; readonly message: string };
    readonly artifact?: BuildJob["artifact"];
  };
}

export interface WorkerHeartbeatRequest {
  readonly workerId: string;
}

export interface WorkerReporter {
  heartbeat(request: WorkerHeartbeatRequest): Promise<void>;
  report(request: WorkerReportRequest): Promise<void>;
}

export interface WorkerExecutionContext {
  readonly workerId: string;
  readonly messageId: string;
  readonly signal: AbortSignal;
  readonly source?: {
    readonly reference: BuildSourceReference;
    readonly snapshot: SourceSnapshot;
    readonly bytes: Buffer;
  };
  /** Disposable project directory containing the verified source snapshot. */
  readonly sourceWorkspace?: string;
  /** Uploads one verified build output through the bound worker channel. */
  readonly uploadArtifact?: (
    content: Buffer,
    contentType?: string,
  ) => Promise<NonNullable<BuildJob["artifact"]>>;
  /**
   * Publish a state transition through the control plane. The executor owns
   * the real stage boundary; the service never fabricates build progress.
   */
  report(report: WorkerReportRequest["report"]): Promise<void>;
}

export interface BuildWorkerExecutor {
  execute(job: BuildJob, context: WorkerExecutionContext): Promise<BuildResult>;
}

export interface BuildWorkerServiceOptions {
  readonly queue: RedisQueue;
  readonly queueName: string;
  readonly worker: Pick<Worker, "id" | "organizationId" | "platform">;
  readonly reporter: WorkerReporter;
  readonly loadBuild: (buildId: string) => Promise<BuildJob | null>;
  /** Fetches the immutable source object referenced by a build. */
  readonly loadSource?: (
    source: BuildSourceReference,
    job: BuildJob,
    signal: AbortSignal,
  ) => Promise<Buffer>;
  /** Stores bytes through the same authenticated worker identity as reports. */
  readonly uploadArtifact?: (
    buildId: string,
    workerId: string,
    content: Buffer,
    contentType: string,
  ) => Promise<NonNullable<BuildJob["artifact"]>>;
  /** Parent directory for disposable source workspaces. */
  readonly sourceWorkspaceRoot?: string;
  readonly executor: BuildWorkerExecutor;
  readonly reclaimIdleMs?: number;
  readonly batchSize?: number;
  readonly blockMs?: number;
  readonly leaseRenewalMs?: number;
  readonly reconnectDelayMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatFailureThreshold?: number;
  readonly onError?: (error: unknown, buildId?: string) => void;
  readonly onRuntimeError?: (error: unknown) => void;
}

export class WorkerServiceError extends Error {
  readonly code:
    | "WORK_ITEM_INVALID"
    | "WORK_ITEM_NOT_FOUND"
    | "WORKER_ORGANIZATION_MISMATCH"
    | "WORKER_PLATFORM_MISMATCH"
    | "WORKER_EXECUTOR_CONTRACT"
    | "WORKER_SOURCE_REQUIRED"
    | "WORKER_SOURCE_INVALID"
    | "WORKER_SERVICE_STATE"
    | "WORKER_HEARTBEAT_CONFIG";

  constructor(code: WorkerServiceError["code"], message: string) {
    super(message);
    this.name = "WorkerServiceError";
    this.code = code;
  }
}
