import { assert } from "@lynxship/contracts";
import { envValue, loadPersistentApp } from "./app.js";
import { createApi } from "./http-api.js";
import { FixedWindowRateLimiter } from "./services.js";

const root = process.env.LYNXSHIP_STATE_DIR ?? process.cwd();
const persistent = await loadPersistentApp(root);
assert(
  process.env.NODE_ENV !== "production" ||
    (process.env.LYNXSHIP_REQUIRE_AUTH === "1" &&
      Boolean(envValue("LYNXSHIP_TOKEN"))),
  "PRODUCTION_CONFIG",
  "Production API requires LYNXSHIP_REQUIRE_AUTH=1 and LYNXSHIP_TOKEN",
);
const tokenManager =
  process.env.LYNXSHIP_REQUIRE_AUTH === "1" ? persistent.app.auth : undefined;
if (tokenManager && envValue("LYNXSHIP_TOKEN"))
  tokenManager.registerRaw({ value: envValue("LYNXSHIP_TOKEN")! });
const configuredLimit = process.env.LYNXSHIP_RATE_LIMIT;
const rateLimiter = configuredLimit
  ? new FixedWindowRateLimiter({ limit: Number(configuredLimit) })
  : undefined;
const server = createApi({
  app: persistent.app,
  persistent: true,
  runtime: persistent.runtime,
  persist: persistent.save,
  tokenManager,
  rateLimiter,
});
await server.listen({
  host: process.env.LYNXSHIP_HOST ?? "0.0.0.0",
  port: Number(process.env.LYNXSHIP_PORT ?? 8787),
});
server.log.info("LynxShip API listening");

const shutdown = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
