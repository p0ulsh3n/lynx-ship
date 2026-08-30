import type { ApiRouteContext } from "../routes.js";
import { assert } from "@lynxship/contracts";
import { WorkerRegistry } from "@lynxship/worker-agent";

export function registerWorkersRoutes(context: ApiRouteContext): void {
  const { server, app, persist, identityFor, canAccess } = context;
  server.post("/v1/workers", async (request, reply) => {
    assertOrganizationScoped(identityFor(request));
    const worker = app.workers.register(
      request.body as Parameters<WorkerRegistry["register"]>[0],
    );
    await persist();
    return reply.code(201).send(worker);
  });
  server.get("/v1/workers", async (request) => {
    assertOrganizationScoped(identityFor(request));
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
    assertOrganizationScoped(identityFor(request));
    assertWorkerTokenBinding(request, identityFor, worker.id);
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
    assertOrganizationScoped(identityFor(request));
    assertWorkerTokenBinding(request, identityFor, worker.id);
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
    assertOrganizationScoped(identityFor(request));
    assertWorkerTokenBinding(request, identityFor, worker.id);
    assert(
      canAccess(request, { organizationId: worker.organizationId }),
      "FORBIDDEN",
      "Worker is outside the authenticated tenant",
    );
    const updated = app.workers.revoke(worker.id);
    await persist();
    return updated;
  });
}

function assertOrganizationScoped(
  identity: ReturnType<ApiRouteContext["identityFor"]>,
): void {
  if (!identity || identity.scopes.includes("*")) return;
  assert(
    !identity.projectId,
    "FORBIDDEN",
    "Worker operations require an organization-scoped token",
  );
}

function assertWorkerTokenBinding(
  request: object,
  identityFor: ApiRouteContext["identityFor"],
  workerId: string,
): void {
  const identity = identityFor(request);
  if (!identity || identity.scopes.includes("*")) return;
  assert(
    !identity.workerId || identity.workerId === workerId,
    "WORKER_TOKEN_MISMATCH",
    "The worker token is bound to a different worker",
  );
}
