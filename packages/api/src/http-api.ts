import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { TokenManager, type TokenRecord } from "@lynxship/auth";
import { BuildService } from "@lynxship/build-orchestrator";
import { LynxShipError, type BuildJob } from "@lynxship/contracts";
import { FileStorage, S3ObjectStorage } from "@lynxship/storage";
import { sha256 } from "@lynxship/contracts";
import { createApp, type LynxShipApp, type RuntimeBackends } from "./app.js";
import {
  authenticateRequest,
  requestTenantScope,
  requiredScope,
} from "./http-auth.js";
import { FixedWindowRateLimiter } from "./services.js";
import { renderPrometheusMetrics } from "./services/metrics.js";
import { createBuildSourceStorage } from "./services/source-storage.js";
import { registerApiRoutes } from "./routes.js";
import { registerHttpErrorHandler } from "./http-errors.js";

async function storeBuildArtifact(
  runtime: RuntimeBackends | undefined,
  job: Awaited<ReturnType<BuildService["run"]>>,
): Promise<void> {
  if (!runtime?.storageStore || !job.artifact) return;

  const content = Buffer.from(
    JSON.stringify({
      buildId: job.id,
      platform: job.platform,
      profile: job.profile,
      artifact: job.artifact,
    }),
  );
  const contentType = "application/vnd.lynxship.artifact+json";

  if (runtime.storageStore instanceof S3ObjectStorage) {
    await runtime.storageStore.put(
      `artifacts/${job.artifact.hash}`,
      content,
      contentType,
    );
  } else if (runtime.storageStore instanceof FileStorage) {
    await runtime.storageStore.put(content, { contentType });
  }
}

async function storeWorkerArtifact(
  runtime: RuntimeBackends | undefined,
  artifactStore: FileStorage,
  job: BuildJob,
  content: Buffer,
  contentType: string,
): Promise<NonNullable<BuildJob["artifact"]>> {
  const hash = sha256(content);
  const key = `artifacts/${job.projectId}/${job.id}/${hash}`;
  if (runtime?.storageStore instanceof S3ObjectStorage) {
    await runtime.storageStore.put(key, content, contentType);
    return {
      name: `${job.id}-${job.platform}`,
      key,
      hash,
      size: content.length,
      contentType,
      url: await runtime.storageStore.presignGet(key),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
  }
  const stored = await artifactStore.put(content, { contentType });
  return {
    name: `${job.id}-${job.platform}`,
    key: stored.key,
    hash: stored.hash,
    size: stored.size,
    contentType: stored.contentType,
  };
}

export interface ApiOptions {
  logger?: boolean;
  app?: LynxShipApp;
  tokenManager?: TokenManager;
  rateLimiter?: FixedWindowRateLimiter;
  dashboardRoot?: string;
  persistent?: boolean;
  runtime?: RuntimeBackends;
  persist?: () => Promise<unknown>;
  artifactRoot?: string;
  allowLocalBuildExecutor?: boolean;
}

export function createApi(options: ApiOptions = {}): FastifyInstance {
  const app = options.app ?? createApp();
  const runtime = options.runtime ?? app.runtime;
  const artifactStore = new FileStorage(
    options.artifactRoot ?? join(process.cwd(), ".lynxship", "objects"),
  );
  const auth = options.tokenManager ?? app.auth;
  const allowLocalBuildExecutor = options.allowLocalBuildExecutor ?? !runtime;
  const server = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 100 * 1024 * 1024,
  });
  server.addContentTypeParser(
    [
      "application/octet-stream",
      "application/zip",
      "application/vnd.android.package-archive",
      "application/x-apple-diskimage",
    ],
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  const identities = new WeakMap<object, Omit<TokenRecord, "hash">>();

  const persist = async (): Promise<void> => {
    await options.persist?.();
  };
  const sourceStorage = createBuildSourceStorage(runtime, artifactStore);

  server.addHook("onClose", async () => {
    await runtime?.close();
  });
  server.addHook("onResponse", async (request, reply) => {
    const method = request.method.toLowerCase();
    const status = String(reply.statusCode);
    app.metrics.increment(
      `http_requests_total|method=${method}|status=${status}`,
    );
  });

  server.addHook("onRequest", async (request) => {
    if (options.rateLimiter) {
      const rate = options.rateLimiter.check(request.ip);
      if (!rate.allowed)
        throw Object.assign(
          new LynxShipError("RATE_LIMITED", "Too many requests"),
          {
            statusCode: 429,
            retryAfter: Math.ceil((rate.resetAt - Date.now()) / 1000),
          },
        );
    }
  });
  server.addHook("preHandler", async (request) => {
    if (options.tokenManager) {
      const scope = requestTenantScope(request);
      const identity = authenticateRequest(
        request,
        options.tokenManager,
        requiredScope(request.method, request.url.split("?")[0]!),
        scope,
      );
      if (identity) identities.set(request, identity);
      const pathname = request.url.split("?")[0]!;
      const tenantRequired =
        request.method === "GET" &&
        [
          "/v1/projects",
          "/v1/builds",
          "/v1/submissions",
          "/v1/workers",
          "/v1/ota/releases",
        ].includes(pathname);
      if (
        tenantRequired &&
        !scope.organizationId &&
        !scope.projectId &&
        !identity?.scopes.includes("*")
      )
        throw new LynxShipError(
          "TENANT_SCOPE",
          "A projectId or organizationId is required for this collection",
        );
    }
  });

  const identityFor = (request: object) => identities.get(request);
  const canAccess = (
    request: object,
    resource: { organizationId: string; projectId?: string },
  ): boolean => {
    const identity = identityFor(request);
    return Boolean(
      !identity ||
      identity.scopes.includes("*") ||
      (identity.organizationId === resource.organizationId &&
        (!identity.projectId || identity.projectId === resource.projectId)),
    );
  };
  registerHttpErrorHandler(server);
  server.get("/", async (_request, reply) => {
    const root = options.dashboardRoot ?? process.cwd();
    const file = join(root, "packages", "dashboard", "dist", "index.html");
    try {
      return reply
        .type("text/html; charset=utf-8")
        .send(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new LynxShipError(
          "DASHBOARD_NOT_BUILT",
          "Dashboard build output is missing",
        );
      throw error;
    }
  });
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/metrics", async (_request, reply) => {
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(renderPrometheusMetrics(app.metrics.snapshot()));
  });
  server.get("/ready", async (_request, reply) => {
    const checks = runtime
      ? await runtime.probe()
      : { database: true, queue: true, storage: true };
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      dependencies: runtime
        ? {
            database: runtime.database,
            queue: runtime.queue,
            storage: runtime.storage,
          }
        : {
            database: options.persistent ? "persistent-json" : "in-memory",
            queue: "memory",
            storage: "filesystem",
          },
      checks,
    });
  });
  registerApiRoutes({
    server,
    app,
    runtime,
    artifactStore,
    auth,
    options,
    allowLocalBuildExecutor,
    storeBuildArtifact,
    storeBuildSource: sourceStorage.store,
    loadBuildSource: sourceStorage.load,
    planBuildSourceUpload: sourceStorage.plan,
    completeBuildSourceUpload: sourceStorage.complete,
    storeWorkerArtifact: (job, content, contentType) =>
      storeWorkerArtifact(runtime, artifactStore, job, content, contentType),
    persist,
    identityFor,
    canAccess,
  });
  return server;
}

export async function startApi(
  options: ApiOptions & { host?: string; port?: number } = {},
): Promise<FastifyInstance> {
  const server = createApi(options);
  await server.listen({
    host: options.host ?? "0.0.0.0",
    port: options.port ?? 8787,
  });
  return server;
}

export { createApp, loadPersistentApp } from "./app.js";

export * from "./services.js";

export * from "@lynxship/build-orchestrator";

export * from "@lynxship/worker-agent";

export * from "@lynxship/worker-service";

export * from "@lynxship/submit";
