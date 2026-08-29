import type { ApiRouteContext } from "../routes.js";
import { validateOtaCheckQuery } from "../contracts.js";
import type { LynxShipApp } from "../app.js";

export function registerOtaRoutes(context: ApiRouteContext): void {
  const { server, app, persist } = context;
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
}
