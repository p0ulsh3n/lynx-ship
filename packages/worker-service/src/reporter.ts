import {
  assert,
  type BuildJob,
  type BuildSourceReference,
} from "@lynxship/contracts";
import type {
  WorkerHeartbeatRequest,
  WorkerReportRequest,
  WorkerReporter,
} from "./contracts.js";

export interface HttpWorkerReporterOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly allowInsecureLocalhost?: boolean;
}

export interface WorkerArtifactUpload {
  readonly name: string;
  readonly hash: string;
  readonly size?: number;
  readonly contentType?: string;
  readonly key?: string;
  readonly url?: string;
  readonly expiresAt?: string;
}

export class WorkerTransportError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WorkerTransportError";
    this.status = status;
  }
}

class HttpWorkerTransport {
  readonly baseUrl: string;

  readonly fetchImpl: typeof fetch;

  readonly timeoutMs: number;

  constructor(private readonly options: HttpWorkerReporterOptions) {
    const url = new URL(options.baseUrl);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    assert(
      url.protocol === "https:" ||
        (options.allowInsecureLocalhost === true &&
          local &&
          url.protocol === "http:"),
      "WORKER_ENDPOINT",
      "Worker control-plane endpoint must use HTTPS",
    );
    assert(
      options.token.length > 0,
      "WORKER_TOKEN",
      "Worker control-plane token is required",
    );
    assert(
      !url.search && !url.hash,
      "WORKER_ENDPOINT",
      "Worker control-plane endpoint must not contain query or fragment data",
    );
    this.baseUrl = url.toString().replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    assert(
      Number.isInteger(this.timeoutMs) &&
        this.timeoutMs >= 1_000 &&
        this.timeoutMs <= 120_000,
      "WORKER_TIMEOUT",
      "Worker HTTP timeout must be between 1000 and 120000 milliseconds",
    );
  }

  async request(
    method: "GET" | "POST",
    path: string,
    extraHeaders: Record<string, string> = {},
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          ...(body === undefined || Buffer.isBuffer(body)
            ? {}
            : { "content-type": "application/json" }),
          ...extraHeaders,
        },
        body:
          body === undefined
            ? undefined
            : Buffer.isBuffer(body)
              ? Uint8Array.from(body)
              : JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) return response;
      const message = (await response.text())
        .slice(0, 512)
        .replace(/[\r\n]/g, " ");
      throw new WorkerTransportError(
        response.status,
        `Worker control-plane request failed with HTTP ${response.status}${message ? `: ${message}` : ""}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** HTTPS-only control-plane reporter used by hosted workers. */
export class HttpWorkerReporter implements WorkerReporter {
  private readonly transport: HttpWorkerTransport;

  constructor(options: HttpWorkerReporterOptions) {
    this.transport = new HttpWorkerTransport(options);
  }

  heartbeat(request: WorkerHeartbeatRequest): Promise<void> {
    return this.transport
      .request(
        "POST",
        `/v1/workers/${encodeURIComponent(request.workerId)}/heartbeat`,
      )
      .then(() => undefined);
  }

  report(request: WorkerReportRequest): Promise<void> {
    return this.transport
      .request(
        "POST",
        `/v1/builds/${encodeURIComponent(request.buildId)}/report`,
        {
          "x-lynxship-worker-id": request.workerId,
          "x-lynxship-report-id": request.reportId,
        },
        request.report,
      )
      .then(() => undefined);
  }
}

/** Loads the authoritative build record through the worker-only API route. */
export class HttpWorkerBuildLoader {
  private readonly transport: HttpWorkerTransport;

  constructor(options: HttpWorkerReporterOptions) {
    this.transport = new HttpWorkerTransport(options);
  }

  async load(buildId: string, workerId: string): Promise<BuildJob | null> {
    try {
      const response = await this.transport.request(
        "GET",
        `/v1/worker-builds/${encodeURIComponent(buildId)}`,
        { "x-lynxship-worker-id": workerId },
      );
      return (await response.json()) as BuildJob;
    } catch (error) {
      if (error instanceof WorkerTransportError && error.status === 404)
        return null;
      throw error;
    }
  }
}

/** Fetches an immutable source snapshot through the worker-only API route. */
export class HttpWorkerSourceLoader {
  private readonly transport: HttpWorkerTransport;

  constructor(options: HttpWorkerReporterOptions) {
    this.transport = new HttpWorkerTransport(options);
  }

  async load(
    buildId: string,
    workerId: string,
    _reference: BuildSourceReference,
  ): Promise<Buffer> {
    const response = await this.transport.request(
      "GET",
      `/v1/worker-builds/${encodeURIComponent(buildId)}/source`,
      { "x-lynxship-worker-id": workerId },
    );
    return Buffer.from(await response.arrayBuffer());
  }
}

export class HttpWorkerArtifactUploader {
  private readonly transport: HttpWorkerTransport;

  constructor(options: HttpWorkerReporterOptions) {
    this.transport = new HttpWorkerTransport(options);
  }

  async upload(
    buildId: string,
    workerId: string,
    content: Buffer,
    contentType = "application/octet-stream",
  ): Promise<WorkerArtifactUpload> {
    const response = await this.transport.request(
      "POST",
      `/v1/worker-builds/${encodeURIComponent(buildId)}/artifact`,
      {
        "x-lynxship-worker-id": workerId,
        "content-type": contentType,
      },
      content,
    );
    const payload = (await response.json()) as {
      artifact: WorkerArtifactUpload;
    };
    return payload.artifact;
  }
}
