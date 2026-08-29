import type { FastifyInstance } from "fastify";
import { TokenManager, type TokenRecord } from "@lynxship/auth";
import type { BuildJob } from "@lynxship/contracts";
import { FileStorage } from "@lynxship/storage";
import type { LynxShipApp, RuntimeBackends } from "./app.js";
import type { ApiOptions } from "./http-api.js";
import { registerResourcesRoutes } from "./routes/resources.js";
import { registerBuildsRoutes } from "./routes/builds.js";
import { registerOtaRoutes } from "./routes/ota.js";
import { registerSubmissionsRoutes } from "./routes/submissions.js";
import { registerWorkersRoutes } from "./routes/workers.js";
import { registerTokensRoutes } from "./routes/tokens.js";

type ApiIdentity = Omit<TokenRecord, "hash">;

export interface ApiRouteContext {
  server: FastifyInstance;
  app: LynxShipApp;
  runtime: RuntimeBackends | undefined;
  artifactStore: FileStorage;
  auth: TokenManager;
  options: ApiOptions;
  allowLocalBuildExecutor: boolean;
  storeBuildArtifact: (
    runtime: RuntimeBackends | undefined,
    job: BuildJob,
  ) => Promise<void>;
  persist: () => Promise<void>;
  identityFor: (request: object) => ApiIdentity | undefined;
  canAccess: (
    request: object,
    resource: { organizationId: string; projectId?: string },
  ) => boolean;
}

export function registerApiRoutes(context: ApiRouteContext): void {
  registerResourcesRoutes(context);
  registerBuildsRoutes(context);
  registerOtaRoutes(context);
  registerSubmissionsRoutes(context);
  registerWorkersRoutes(context);
  registerTokensRoutes(context);
}
