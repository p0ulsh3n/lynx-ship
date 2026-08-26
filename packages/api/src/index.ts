import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { TokenManager, type TokenRecord } from "@lynxship/auth";
import { BuildService } from "@lynxship/build-orchestrator";
import {
  assert,
  LynxShipError,
  sha256,
  type BuildJob,
} from "@lynxship/contracts";
import { SubmissionService } from "@lynxship/submit";
import { FileStorage, S3ObjectStorage } from "@lynxship/storage";
import { WorkerRegistry } from "@lynxship/worker-agent";
import {
  createApp,
  loadPersistentApp,
  type LynxShipApp,
  type RuntimeBackends,
} from "./app.js";
import { validateBuildRequest, validateOtaCheckQuery } from "./contracts.js";
import {
  authenticateRequest,
  requestTenantScope,
  requiredScope,
} from "./http-auth.js";
import { FixedWindowRateLimiter } from "./services.js";

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
  const allowLocalBuildExecutor =
    options.allowLocalBuildExecutor ??
    (!runtime || process.env.NODE_ENV !== "production");
  const server = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 100 * 1024 * 1024,
  });
  const identities = new WeakMap<object, Omit<TokenRecord, "hash">>();

  const persist = async (): Promise<void> => {
    await options.persist?.();
  };

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
  server.setErrorHandler((error: unknown, request, reply) => {
    const typed = error as {
      code?: string;
      message?: string;
      details?: Record<string, unknown>;
      statusCode?: number;
      retryAfter?: number;
    };
    const authStatus: Record<string, number> = {
      AUTH_REQUIRED: 401,
      AUTH_INVALID: 401,
      AUTH_REVOKED: 401,
      AUTH_EXPIRED: 401,
      AUTH_SCOPE: 403,
      FORBIDDEN: 403,
      TENANT_SCOPE: 403,
    };
    const status =
      typed.statusCode ??
      (typed.code ? authStatus[typed.code] : undefined) ??
      (error instanceof LynxShipError ? 400 : 500);
    if (status >= 500) request.log.error(error);
    const headers = typed.retryAfter
      ? { "retry-after": String(typed.retryAfter) }
      : undefined;
    return reply
      .code(status)
      .headers(headers ?? {})
      .send({
        error: typed.code ?? "INTERNAL_ERROR",
        message: status >= 500 ? "Internal server error" : typed.message,
        details: typed.details ?? {},
      });
  });
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
    const lines = Object.entries(app.metrics.snapshot()).map(([key, value]) => {
      const [name, ...labels] = key.split("|");
      const renderedLabels = labels
        .map((label) => {
          const [labelName, labelValue] = label.split("=");
          return `${labelName}="${labelValue?.replaceAll('"', '\\"')}"`;
        })
        .join(",");
      return `lynxship_${name}${renderedLabels ? `{${renderedLabels}}` : ""} ${value}`;
    });
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(`${lines.join("\n")}\n`);
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
  server.post("/v1/organizations", async (request, reply) => {
    const body = request.body as { name: string; ownerUserId: string };
    const organization = app.tenants.createOrganization(
      body.name,
      body.ownerUserId,
    );
    await persist();
    return reply.code(201).send(organization);
  });
  server.post("/v1/projects", async (request, reply) => {
    const body = request.body as { organizationId: string; name: string };
    const project = app.tenants.createProject(body.organizationId, body.name);
    await persist();
    return reply.code(201).send(project);
  });
  server.get("/v1/projects", async (request) => {
    const query = request.query as { organizationId?: string };
    const organizationId =
      query.organizationId ?? identityFor(request)?.organizationId ?? "";
    return app.tenants.listProjects(organizationId);
  });
  server.post("/v1/artifacts", async (request, reply) => {
    const body = request.body as {
      projectId: string;
      organizationId: string;
      filename: string;
      contentType?: string;
      hash: string;
      dataBase64: string;
      artifact?: {
        key: string;
        hash: string;
        size?: number;
        contentType?: string;
        url: string;
        expiresAt?: string;
      };
    };
    assert(
      body.projectId && body.organizationId && body.filename,
      "ARTIFACT_INPUT",
      "Project, organization and filename are required",
    );
    const artifact = body.artifact
      ? body.artifact
      : await (async () => {
          assert(
            runtime?.storage !== "r2",
            "ARTIFACT_EXTERNAL_STORAGE",
            "The R2 runtime accepts artifact metadata, not binary uploads",
          );
          assert(
            body.hash && body.dataBase64,
            "ARTIFACT_DATA",
            "Artifact metadata or base64 data is required",
          );
          const content = Buffer.from(body.dataBase64, "base64");
          assert(
            sha256(content) === body.hash,
            "ARTIFACT_HASH",
            "Artifact hash does not match uploaded content",
          );
          const contentType = body.contentType ?? "application/octet-stream";
          if (runtime?.storageStore instanceof S3ObjectStorage) {
            const key = `artifacts/${body.hash}`;
            await runtime.storageStore.put(key, content, contentType);
            return {
              key,
              hash: body.hash,
              size: content.length,
              contentType,
            };
          }
          return artifactStore.put(content, { contentType });
        })();
    if (body.artifact)
      assert(
        artifact.key &&
          artifact.hash &&
          body.artifact.url.startsWith("https://"),
        "ARTIFACT_METADATA",
        "R2 artifact key, hash and HTTPS download URL are required",
      );
    await persist();
    return reply.code(201).send({
      artifact,
      projectId: body.projectId,
      organizationId: body.organizationId,
      filename: body.filename,
    });
  });
  server.post("/v1/builds", async (request, reply) => {
    const input = validateBuildRequest(request.body);
    const existing = input.idempotencyKey
      ? app.builds
          .list()
          .find(
            (candidate) =>
              candidate.idempotencyKey === input.idempotencyKey &&
              candidate.projectId === input.projectId &&
              candidate.organizationId === input.organizationId,
          )
      : undefined;
    if (existing) return reply.code(200).send(existing);
    const job = await app.builds.create(input);
    await runtime?.queueStore?.enqueue("builds", { buildId: job.id });
    await persist();
    return reply.code(201).send(job);
  });
  server.get("/v1/builds", async (request) => {
    const query = request.query as {
      organizationId?: string;
      projectId?: string;
    };
    return app.builds.list().filter(
      (job) =>
        canAccess(request, {
          organizationId: job.organizationId,
          projectId: job.projectId,
        }) &&
        (!query.organizationId ||
          job.organizationId === query.organizationId) &&
        (!query.projectId || job.projectId === query.projectId),
    );
  });
  server.post("/v1/builds/:id/run", async (request) => {
    assert(
      allowLocalBuildExecutor,
      "BUILD_WORKER_REQUIRED",
      "Production builds must be executed by an isolated platform worker; the local executor is disabled",
    );
    const id = (request.params as { id: string }).id;
    const existing = app.builds.get(id);
    assert(
      canAccess(request, existing),
      "FORBIDDEN",
      "Build is outside the authenticated tenant",
    );
    const job = await app.builds.run(id);
    await storeBuildArtifact(runtime, job);
    await persist();
    return job;
  });
  server.post("/v1/builds/:id/report", async (request) => {
    const id = (request.params as { id: string }).id;
    const existing = app.builds.get(id);
    assert(
      canAccess(request, existing),
      "FORBIDDEN",
      "Build is outside the authenticated tenant",
    );
    const body = request.body as {
      state?: string;
      reason?: string;
      log?: { level?: string; message?: string };
      artifact?: BuildJob["artifact"];
    };
    assert(
      body.state &&
        [
          "uploading_source",
          "queued",
          "provisioning",
          "installing_dependencies",
          "building",
          "signing",
          "uploading_artifacts",
          "success",
          "failed",
          "canceled",
          "timed_out",
        ].includes(body.state),
      "BUILD_REPORT",
      "Worker report contains an invalid state",
    );
    if (body.artifact) {
      assert(
        body.artifact.name && body.artifact.hash,
        "BUILD_ARTIFACT",
        "Worker artifact name and hash are required",
      );
      if (body.artifact.url)
        assert(
          body.artifact.url.startsWith("https://"),
          "BUILD_ARTIFACT",
          "Worker artifact URL must use HTTPS",
        );
    }
    const job = app.builds.report(id, {
      state: body.state as BuildJob["state"],
      reason: body.reason,
      log: body.log?.message
        ? { level: body.log.level ?? "info", message: body.log.message }
        : undefined,
      artifact: body.artifact,
    });
    await persist();
    return job;
  });
  server.post("/v1/builds/:id/cancel", async (request) => {
    const id = (request.params as { id: string }).id;
    const existing = app.builds.get(id);
    assert(
      canAccess(request, existing),
      "FORBIDDEN",
      "Build is outside the authenticated tenant",
    );
    const job = app.builds.cancel(id);
    await persist();
    return job;
  });
  server.post("/v1/builds/:id/retry", async (request) => {
    const id = (request.params as { id: string }).id;
    const existing = app.builds.get(id);
    assert(
      canAccess(request, existing),
      "FORBIDDEN",
      "Build is outside the authenticated tenant",
    );
    const job = app.builds.retry(id);
    await runtime?.queueStore?.enqueue("builds", { buildId: job.id });
    await persist();
    return job;
  });
  server.get("/v1/builds/:id", async (request) => {
    const job = app.builds.get((request.params as { id: string }).id);
    assert(
      canAccess(request, job),
      "FORBIDDEN",
      "Build is outside the authenticated tenant",
    );
    return job;
  });
  server.post("/v1/ota/releases", async (request, reply) => {
    const release = app.ota.publish(
      request.body as Parameters<LynxShipApp["ota"]["publish"]>[0],
    );
    await persist();
    return reply.code(201).send(release);
  });
  server.post("/v1/ota/rollback", async (request) => {
    const release = app.ota.rollback(
      request.body as Parameters<LynxShipApp["ota"]["rollback"]>[0],
    );
    await persist();
    return release;
  });
  server.get("/v1/ota/public-key", async () => ({
    keyId: app.ota.signingKey.keyId,
    publicKey: app.ota.signingKey.publicKey,
  }));
  server.get("/v1/ota/releases", async (request) => {
    const query = request.query as { projectId?: string; channel?: string };
    return app.ota.history(
      query.projectId ?? "",
      query.channel ?? "production",
    );
  });
  server.get("/v1/ota/check", async (request) =>
    app.ota.check(
      validateOtaCheckQuery(
        request.query as Record<string, string | undefined>,
      ),
    ),
  );
  server.post("/v1/submissions", async (request, reply) => {
    const submission = await app.submissions.submit(
      request.body as Parameters<SubmissionService["submit"]>[0],
    );
    await persist();
    return reply.code(201).send(submission);
  });
  server.get("/v1/submissions", async (request) => {
    const query = request.query as {
      organizationId?: string;
      projectId?: string;
    };
    return app.submissions.list().filter(
      (submission) =>
        canAccess(request, {
          organizationId: submission.organizationId,
          projectId: submission.projectId,
        }) &&
        (!query.organizationId ||
          submission.organizationId === query.organizationId) &&
        (!query.projectId || submission.projectId === query.projectId),
    );
  });
  server.post("/v1/workers", async (request, reply) => {
    const worker = app.workers.register(
      request.body as Parameters<WorkerRegistry["register"]>[0],
    );
    await persist();
    return reply.code(201).send(worker);
  });
  server.get("/v1/workers", async (request) => {
    const requested = (request.query as { organizationId?: string })
      .organizationId;
    const organizationId = requested ?? identityFor(request)?.organizationId;
    return app.workers
      .list(organizationId)
      .filter((worker) =>
        canAccess(request, { organizationId: worker.organizationId }),
      );
  });
  server.post("/v1/workers/:id/heartbeat", async (request) => {
    const worker = app.workers.get((request.params as { id: string }).id);
    assert(
      canAccess(request, { organizationId: worker.organizationId }),
      "FORBIDDEN",
      "Worker is outside the authenticated tenant",
    );
    const updated = app.workers.heartbeat(worker.id);
    await persist();
    return updated;
  });
  server.post("/v1/workers/:id/drain", async (request) => {
    const worker = app.workers.get((request.params as { id: string }).id);
    assert(
      canAccess(request, { organizationId: worker.organizationId }),
      "FORBIDDEN",
      "Worker is outside the authenticated tenant",
    );
    const updated = app.workers.drain(worker.id);
    await persist();
    return updated;
  });
  server.post("/v1/workers/:id/revoke", async (request) => {
    const worker = app.workers.get((request.params as { id: string }).id);
    assert(
      canAccess(request, { organizationId: worker.organizationId }),
      "FORBIDDEN",
      "Worker is outside the authenticated tenant",
    );
    const updated = app.workers.revoke(worker.id);
    await persist();
    return updated;
  });
  server.post("/v1/tokens", async (request, reply) => {
    const body = request.body as {
      name?: string;
      organizationId?: string;
      projectId?: string;
      scopes?: string[];
      expiresAt?: string | null;
    };
    assert(
      typeof body.name === "string" &&
        typeof body.organizationId === "string" &&
        body.name.length > 0 &&
        body.organizationId.length > 0,
      "TOKEN_INPUT",
      "Token name and organizationId are required",
    );
    const token = auth.create({
      name: body.name,
      organizationId: body.organizationId,
      projectId: body.projectId,
      scopes: body.scopes,
      expiresAt: body.expiresAt,
    });
    await persist();
    return reply.code(201).send(token);
  });
  server.get("/v1/tokens", async (request) => {
    const query = request.query as {
      organizationId?: string;
      projectId?: string;
    };
    return auth.list().filter(
      (token) =>
        (!query.organizationId ||
          token.organizationId === query.organizationId) &&
        (!query.projectId || token.projectId === query.projectId) &&
        canAccess(request, {
          organizationId: token.organizationId,
          projectId: token.projectId ?? undefined,
        }),
    );
  });
  server.delete("/v1/tokens/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    const token = auth.list().find((candidate) => candidate.id === id);
    assert(token, "TOKEN_NOT_FOUND", "Token not found");
    assert(
      canAccess(request, {
        organizationId: token.organizationId,
        projectId: token.projectId ?? undefined,
      }),
      "FORBIDDEN",
      "Token is outside the authenticated tenant",
    );
    auth.revoke(id);
    await persist();
    return { status: "revoked", id };
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

export * from "@lynxship/submit";
