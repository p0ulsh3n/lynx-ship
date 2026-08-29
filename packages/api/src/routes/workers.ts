import type { ApiRouteContext } from "../routes.js";
import { assert } from "@lynxship/contracts";
import { WorkerRegistry } from "@lynxship/worker-agent";

export function registerWorkersRoutes(context: ApiRouteContext): void {
  const { server, app, persist, identityFor, canAccess } = context;
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
}
