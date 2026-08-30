import type { ApiRouteContext } from "../routes.js";
import { assert } from "@lynxship/contracts";

export function registerTokensRoutes(context: ApiRouteContext): void {
  const { server, app, auth, persist, canAccess } = context;
  server.post("/v1/tokens", async (request, reply) => {
    const body = request.body as {
      name?: string;
      organizationId?: string;
      projectId?: string;
      workerId?: string;
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
    const identity = context.identityFor(request);
    if (identity && !identity.scopes.includes("*")) {
      assert(
        identity.organizationId === body.organizationId,
        "FORBIDDEN",
        "Token organization is outside the authenticated tenant",
      );
      if (identity.projectId) {
        assert(
          body.projectId === identity.projectId && !body.workerId,
          "FORBIDDEN",
          "A project-scoped token can only mint a token for the same project",
        );
        assert(
          !(body.scopes ?? []).some((scope) => scope.startsWith("worker:")),
          "FORBIDDEN",
          "A project-scoped token cannot mint worker credentials",
        );
      }
    }
    if (body.workerId) {
      const worker = app.workers.get(body.workerId);
      assert(
        worker.organizationId === body.organizationId,
        "WORKER_TOKEN_BINDING",
        "Worker token organization must match the worker organization",
      );
    }
    const token = auth.create({
      name: body.name,
      organizationId: body.organizationId,
      projectId: body.projectId,
      workerId: body.workerId,
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
}
