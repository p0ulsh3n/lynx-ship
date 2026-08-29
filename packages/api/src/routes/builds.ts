import type { ApiRouteContext } from "../routes.js";
import { assert, type BuildJob } from "@lynxship/contracts";
import { validateBuildRequest } from "../contracts.js";

export function registerBuildsRoutes(context: ApiRouteContext): void {
  const {
    server,
    app,
    runtime,
    allowLocalBuildExecutor,
    storeBuildArtifact,
    persist,
    canAccess,
  } = context;
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
}
