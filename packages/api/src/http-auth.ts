import { LynxShipError } from "@lynxship/contracts";
import { TokenManager, type TokenRecord } from "@lynxship/auth";

export interface RequestTenantScope {
  organizationId?: string;
  projectId?: string;
}

export function requiredScope(method: string, pathname: string): string | null {
  if (pathname === "/health" || pathname === "/ready") return null;
  if (pathname === "/v1/ota/check" || pathname === "/v1/ota/public-key")
    return null;
  if (pathname.startsWith("/v1/tokens")) return "credentials:write";
  if (method === "GET") return "project:read";
  if (pathname.startsWith("/v1/artifacts")) return "build:write";
  if (pathname.startsWith("/v1/builds")) return "build:write";
  if (pathname.startsWith("/v1/ota")) return "update:write";
  if (pathname.startsWith("/v1/submissions")) return "submit:write";
  if (pathname.startsWith("/v1/workers")) return "build:write";
  if (pathname === "/v1/organizations" || pathname === "/v1/projects")
    return method === "GET" ? "project:read" : "project:write";
  return "project:read";
}

export function authenticateRequest(
  request: { headers: { authorization?: string } },
  tokenManager: TokenManager,
  scope: string | null,
  tenant: RequestTenantScope = {},
): Omit<TokenRecord, "hash"> | null {
  if (!scope) return null;
  const match = (request.headers.authorization ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new LynxShipError("AUTH_REQUIRED", "Bearer token required");
  return tokenManager.authenticate(match[1]!, {
    requiredScope: scope,
    organizationId: tenant.organizationId,
    projectId: tenant.projectId,
  });
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

export function requestTenantScope(request: {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}): RequestTenantScope {
  const body = request.body;
  const query = request.query;
  const params = request.params;
  const manifest =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).manifest
      : undefined;
  return {
    organizationId:
      stringField(body, "organizationId") ??
      stringField(query, "organizationId") ??
      stringField(manifest, "organizationId"),
    projectId:
      stringField(body, "projectId") ??
      stringField(query, "projectId") ??
      stringField(params, "projectId") ??
      stringField(manifest, "projectId"),
  };
}
