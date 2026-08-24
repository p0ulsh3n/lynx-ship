import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { TokenManager } from "@lynxship/auth";
import { BuildService } from "@lynxship/build-orchestrator";
import { assert, LynxShipError, sha256 } from "@lynxship/contracts";
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
import { authenticateRequest, requiredScope } from "./http-auth.js";
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
}

export function createApi(options: ApiOptions = {}): FastifyInstance {
  const app = options.app ?? createApp();
  const runtime = options.runtime ?? app.runtime;
  const artifactStore = new FileStorage(
    options.artifactRoot ?? join(process.cwd(), ".lynxship", "objects"),
  );
  const server = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 100 * 1024 * 1024,
  });

  const persist = async (): Promise<void> => {
    await options.persist?.();
  };

  server.addHook("onClose", async () => {
    await runtime?.close();
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
    if (options.tokenManager)
      authenticateRequest(
        request,
        options.tokenManager,
        requiredScope(request.method, request.url.split("?")[0]!),
      );
  });
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
  server.get("/ready", async () => ({
    status: "ready",
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
  }));
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
  server.get("/v1/projects", async (request) =>
    app.tenants.listProjects(
      (request.query as { organizationId?: string }).organizationId ?? "",
    ),
  );
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
    const job = await app.builds.create(validateBuildRequest(request.body));
    await runtime?.queueStore?.enqueue("builds", { buildId: job.id });
    await persist();
    return reply.code(201).send(job);
  });
  server.get("/v1/builds", async () => app.builds.list());
  server.post("/v1/builds/:id/run", async (request) => {
    const job = await app.builds.run((request.params as { id: string }).id);
    await storeBuildArtifact(runtime, job);
    await persist();
    return job;
  });
  server.post("/v1/builds/:id/cancel", async (request) => {
    const job = app.builds.cancel((request.params as { id: string }).id);
    await persist();
    return job;
  });
  server.post("/v1/builds/:id/retry", async (request) => {
    const job = app.builds.retry((request.params as { id: string }).id);
    await runtime?.queueStore?.enqueue("builds", { buildId: job.id });
    await persist();
    return job;
  });
  server.get("/v1/builds/:id", async (request) =>
    app.builds.get((request.params as { id: string }).id),
  );
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
  server.get("/v1/submissions", async () => app.submissions.list());
  server.post("/v1/workers", async (request, reply) => {
    const worker = app.workers.register(
      request.body as Parameters<WorkerRegistry["register"]>[0],
    );
    await persist();
    return reply.code(201).send(worker);
  });
  server.get("/v1/workers", async (request) =>
    app.workers.list(
      (request.query as { organizationId?: string }).organizationId,
    ),
  );
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
