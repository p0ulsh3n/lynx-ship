import { assert, type BuildResult, type BuildState } from "@lynxship/contracts";
import type { SourceSnapshot } from "@lynxship/build-orchestrator";
import {
  RedisWorkerRuntime,
  type WorkerMessageContext,
} from "@lynxship/worker-agent";
import type {
  BuildWorkerServiceOptions,
  WorkerExecutionContext,
  WorkerReportRequest,
} from "./contracts.js";
import { WorkerServiceError } from "./contracts.js";
import {
  assertWorkItemMatchesJob,
  assertWorkerCanProcess,
  parseBuildWorkItem,
} from "./validation.js";
import { materializeWorkerSource } from "./workspace.js";

type ServiceState = "idle" | "running" | "stopping" | "stopped";
const terminalStates = new Set<BuildState>([
  "success",
  "failed",
  "canceled",
  "timed_out",
]);

/**
 * Hosted-worker orchestration boundary. It validates the immutable queue
 * envelope against the authoritative build record, binds work to one tenant
 * and platform, reports only executor-owned lifecycle transitions, and keeps
 * Redis at-least-once delivery safe through explicit retries.
 */
export class BuildWorkerService {
  private state: ServiceState = "idle";

  private readonly runtime: RedisWorkerRuntime<unknown>;

  private runPromise: Promise<void> | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private heartbeatInFlight = false;

  private heartbeatFailures = 0;

  constructor(readonly options: BuildWorkerServiceOptions) {
    const interval = options.heartbeatIntervalMs ?? 30_000;
    const threshold = options.heartbeatFailureThreshold ?? 3;
    assert(
      Number.isInteger(interval) && interval >= 1_000 && interval <= 300_000,
      "WORKER_HEARTBEAT_CONFIG",
      "Heartbeat interval must be between 1000 and 300000 milliseconds",
    );
    assert(
      Number.isInteger(threshold) && threshold >= 1 && threshold <= 10,
      "WORKER_HEARTBEAT_CONFIG",
      "Heartbeat failure threshold must be between 1 and 10",
    );
    this.runtime = new RedisWorkerRuntime({
      queue: options.queue,
      queueName: options.queueName,
      workerId: options.worker.id,
      reclaimIdleMs: options.reclaimIdleMs,
      batchSize: options.batchSize,
      blockMs: options.blockMs,
      leaseRenewalMs: options.leaseRenewalMs,
      reconnectDelayMs: options.reconnectDelayMs,
      onError: (error, message) =>
        options.onError?.(error, extractBuildId(message.payload)),
      onRuntimeError: options.onRuntimeError,
    });
  }

  get status(): ServiceState {
    return this.state;
  }

  /** Start the heartbeat and Redis consumer. The promise resolves on stop. */
  async start(): Promise<void> {
    assert(
      this.state === "idle",
      "WORKER_SERVICE_STATE",
      "Worker service can start only once",
    );
    await this.options.reporter.heartbeat({ workerId: this.options.worker.id });
    this.state = "running";
    this.startHeartbeat();
    this.runPromise = this.runtime.run(async (payload, context) => {
      await this.process(payload, context);
    });
    try {
      await this.runPromise;
    } finally {
      this.clearHeartbeat();
      this.state = "stopped";
    }
  }

  async stop(): Promise<void> {
    if (this.state === "idle" || this.state === "stopped") return;
    this.state = "stopping";
    this.runtime.stop();
    this.clearHeartbeat();
    await this.runPromise;
  }

  async process(
    payload: unknown,
    message: WorkerMessageContext,
  ): Promise<BuildResult> {
    assert(
      message.workerId === this.options.worker.id,
      "WORKER_PLATFORM_MISMATCH",
      "Queue message is not owned by this worker runtime",
    );
    const item = parseBuildWorkItem(payload);
    const job = await this.options.loadBuild(item.buildId);
    if (!job)
      throw new WorkerServiceError(
        "WORK_ITEM_NOT_FOUND",
        `Build ${item.buildId} was not found`,
      );
    assertWorkItemMatchesJob(item, job);
    assertWorkerCanProcess(this.options.worker, job);
    if (terminalStates.has(job.state)) return { logs: [] };
    const controller = new AbortController();
    let source:
      | {
          readonly reference: NonNullable<typeof job.source>;
          readonly snapshot: SourceSnapshot;
          readonly bytes: Buffer;
        }
      | undefined;
    let sourceWorkspace:
      | Awaited<ReturnType<typeof materializeWorkerSource>>
      | undefined;
    let sequence = 0;
    let terminalReported = false;
    const context: WorkerExecutionContext = {
      workerId: this.options.worker.id,
      messageId: message.messageId,
      signal: controller.signal,
      get source() {
        return source;
      },
      get sourceWorkspace() {
        return sourceWorkspace?.path;
      },
      uploadArtifact: this.options.uploadArtifact
        ? (content, contentType = "application/octet-stream") =>
            this.options.uploadArtifact!(
              job.id,
              this.options.worker.id,
              content,
              contentType,
            )
        : undefined,
      report: async (report) => {
        if (terminalReported)
          throw new WorkerServiceError(
            "WORKER_EXECUTOR_CONTRACT",
            "A worker cannot report a state after a terminal state",
          );
        const reportId = `${this.options.worker.id}:${job.id}:${++sequence}`;
        const request: WorkerReportRequest = {
          workerId: this.options.worker.id,
          buildId: job.id,
          reportId,
          report,
        };
        await this.options.reporter.report(request);
        if (terminalStates.has(report.state)) terminalReported = true;
      },
    };
    try {
      if (job.source) {
        if (!this.options.loadSource)
          throw new WorkerServiceError(
            "WORKER_SOURCE_REQUIRED",
            "This build references a source snapshot but no source loader is configured",
          );
        const bytes = await this.options.loadSource(
          job.source,
          job,
          controller.signal,
        );
        sourceWorkspace = await materializeWorkerSource(
          { reference: job.source, bytes },
          { parentDirectory: this.options.sourceWorkspaceRoot },
        );
        source = {
          reference: job.source,
          bytes,
          snapshot: sourceWorkspace.snapshot,
        };
      }
      const result = await this.options.executor.execute(job, context);
      if (!terminalReported)
        throw new WorkerServiceError(
          "WORKER_EXECUTOR_CONTRACT",
          "Worker executor completed without reporting a terminal state",
        );
      return result;
    } catch (error) {
      if (!terminalReported) {
        await context.report({
          state: "failed",
          reason: safeErrorMessage(error),
          log: { level: "error", message: safeErrorMessage(error) },
        });
      }
      return { logs: [] };
    } finally {
      await sourceWorkspace?.cleanup().catch((error: unknown) => {
        this.options.onRuntimeError?.(error);
      });
    }
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalMs ?? 30_000;
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatInFlight || this.state !== "running") return;
      this.heartbeatInFlight = true;
      void this.options.reporter
        .heartbeat({ workerId: this.options.worker.id })
        .then(() => {
          this.heartbeatFailures = 0;
        })
        .catch((error: unknown) => {
          this.heartbeatFailures += 1;
          this.options.onError?.(error);
          if (
            this.heartbeatFailures >=
            (this.options.heartbeatFailureThreshold ?? 3)
          )
            void this.stop();
        })
        .finally(() => {
          this.heartbeatInFlight = false;
        });
    }, interval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000).replace(/[\r\n]/g, " ");
}

function extractBuildId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>).buildId;
  return typeof value === "string" ? value : undefined;
}
