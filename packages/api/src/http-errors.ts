import type { FastifyInstance } from "fastify";
import { LynxShipError } from "@lynxship/contracts";

/** Registers the public error envelope and HTTP status policy. */
export function registerHttpErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((error: unknown, request, reply) => {
    const typed = error as {
      code?: string;
      message?: string;
      details?: Record<string, unknown>;
      statusCode?: number;
      retryAfter?: number;
    };
    const statusByCode: Record<string, number> = {
      AUTH_REQUIRED: 401,
      AUTH_INVALID: 401,
      AUTH_REVOKED: 401,
      AUTH_EXPIRED: 401,
      AUTH_SCOPE: 403,
      FORBIDDEN: 403,
      TENANT_SCOPE: 403,
      WORKER_TOKEN_MISMATCH: 403,
      WORKER_ID_REQUIRED: 403,
      WORKER_NOT_FOUND: 403,
      WORKER_PLATFORM_MISMATCH: 403,
      WORKER_REVOKED: 403,
      BUILD_NOT_FOUND: 404,
    };
    const status =
      typed.statusCode ??
      (typed.code ? statusByCode[typed.code] : undefined) ??
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
}
