import type { ApiRouteContext } from "../routes.js";
import { assert, type BuildJob } from "@lynxship/contracts";
import { createBuildWorkItem } from "@lynxship/worker-service";
import { validateBuildRequest } from "../contracts.js";

export function registerBuildsRoutes(context: ApiRouteContext): void {
  const {
    server,
    app,
    runtime,
    allowLocalBuildExecutor,
    storeBuildArtifact,
    loadBuildSource,
    storeWorkerArtifact,
    persist,
    identityFor,
    canAccess,
  } = context;
  server.get("/v1/worker-builds/:id", async (request) => {
    const workerId = headerValue(request.headers["x-lynxship-worker-id"]);
    const identity = identityFor(request);
    if (identity) {
      assert(
        workerId,
        "WORKER_ID_REQUIRED",
        "Worker build reads must include x-lynxship-worker-id",
      );
      assert(
        identity.scopes.includes("*") ||
          identity.scopes.includes("worker:manage") ||
          identity.workerId === workerId,
        "WORKER_TOKEN_MISMATCH",
        "The worker token is bound to a different worker",
      );
    }
    assert(workerId, "WORKER_ID_REQUIRED", "Worker id is required");
    const worker = app.workers.get(workerId);
    assert(
      worker.status !== "revoked",
      "WORKER_REVOKED",
      "Revoked workers cannot read build work",
    );
    const job = app.builds.get((request.params as { id: string }).id);
    assert(
      worker.organizationId === job.organizationId &&
        worker.platform === job.platform,
      "WORKER_PLATFORM_MISMATCH",
      "Worker organization or platform does not match the build",
    );
    assert(
      canAccess(request, job),
      "FORBIDDEN",
      "Build is outside the authenticated tenant",
    );
    return job;
  });
  server.get("/v1/worker-builds/:id/source", async (request, reply) => {
    const workerId = headerValue(request.headers["x-lynxship-worker-id"]);
    const identity = identityFor(request);
    assert(workerId, "WORKER_ID_REQUIRED", "Worker id is required");
    if (identity)
      assert(
        identity.scopes.includes("*") ||
          identity.scopes.includes("worker:manage") ||
          identity.workerId === workerId,
        "WORKER_TOKEN_MISMATCH",
        "The worker token is bound to a different worker",
      );
    const worker = app.workers.get(workerId);
    assert(
      worker.status !== "revoked",
      "WORKER_REVOKED",
      "Revoked workers cannot read build source",
    );
    const job = app.builds.get((request.params as { id: string }).id);
    assert(
      worker.organizationId === job.organizationId &&
        worker.platform === job.platform,
      "WORKER_PLATFORM_MISMATCH",
      "Worker organization or platform does not match the build",
    );
    assert(
      canAccess(request, job),
      "FORBIDDEN",
      "Build is outside the authenticated tenant",
    );
    assert(
      job.source,
      "BUILD_SOURCE_REQUIRED",
      "Build does not reference a source snapshot",
    );
    const content = await loadBuildSource(job.source);
    return reply
      .type(job.source.contentType)
      .header("cache-control", "no-store")
      .send(content);
  });
  server.post("/v1/worker-builds/:id/artifact", async (request, reply) => {
    const workerId = headerValue(request.headers["x-lynxship-worker-id"]);
    const identity = identityFor(request);
    assert(workerId, "WORKER_ID_REQUIRED", "Worker id is required");
    if (identity)
      assert(
        identity.scopes.includes("*") ||
          identity.scopes.includes("worker:report") ||
          identity.workerId === workerId,
        "WORKER_TOKEN_MISMATCH",
        "Worker token is bound to a different worker",
      );
    const worker = app.workers.get(workerId);
    assert(
      worker.status !== "revoked",
      "WORKER_REVOKED",
      "Revoked workers cannot upload artifacts",
    );
    const job = app.builds.get((request.params as { id: string }).id);
    assert(
      worker.organizationId === job.organizationId &&
        worker.platform === job.platform,
      "WORKER_PLATFORM_MISMATCH",
      "Worker organization or platform does not match the build",
    );
    assert(
      canAccess(request, job),
      "FORBIDDEN",
      "Build is outside the authenticated tenant",
    );
    assert(
      Buffer.isBuffer(request.body) && request.body.length > 0,
      "WORKER_ARTIFACT_REQUIRED",
      "Worker artifact upload must contain binary content",
    );
    assert(
      job.state === "uploading_artifacts",
      "WORKER_ARTIFACT_STATE",
      "Worker artifacts can only be uploaded after the build enters uploading_artifacts",
    );
    const contentType =
      headerValue(request.headers["content-type"]) ??
      "application/octet-stream";
    const artifact = await storeWorkerArtifact(
      job,
      request.body as Buffer,
      contentType.split(";", 1)[0]!.trim(),
    );
    const updated = app.builds.report(job.id, {
      state: job.state,
      artifact,
      log: { level: "info", message: "Worker artifact stored" },
    });
    await persist();
    return reply.code(201).send({ artifact, job: updated });
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
    await runtime?.queueStore?.enqueue("builds", createBuildWorkItem(job));
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
    const workerId = headerValue(request.headers["x-lynxship-worker-id"]);
    const identity = identityFor(request);
    if (identity) {
      assert(
        workerId,
        "WORKER_ID_REQUIRED",
        "Worker reports must include x-lynxship-worker-id",
      );
      assert(
        !identity.workerId || identity.workerId === workerId,
        "WORKER_TOKEN_MISMATCH",
        "The worker token is bound to a different worker",
      );
    }
    const worker = workerId ? app.workers.get(workerId) : undefined;
    if (worker) {
      assert(
        worker.status !== "revoked",
        "WORKER_REVOKED",
        "Revoked workers cannot report build state",
      );
      assert(
        worker.organizationId === existing.organizationId &&
          worker.platform === existing.platform,
        "WORKER_PLATFORM_MISMATCH",
        "Worker platform or organization does not match the build",
      );
    }
    if (identity && !worker)
      assert(
        false,
        "WORKER_NOT_FOUND",
        "Worker reports must reference a registered worker",
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
    await runtime?.queueStore?.enqueue("builds", createBuildWorkItem(job));
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
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
