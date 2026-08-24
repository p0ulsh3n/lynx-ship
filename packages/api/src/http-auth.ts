import { LynxShipError } from "@lynxship/contracts";
import { TokenManager } from "@lynxship/auth";

export function requiredScope(method: string, pathname: string): string | null {
  if (pathname === "/health" || pathname === "/ready") return null;
  if (pathname === "/v1/ota/check" || pathname === "/v1/ota/public-key")
    return null;
  if (method === "GET") return "project:read";
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
): void {
  if (!scope) return;
  const match = (request.headers.authorization ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new LynxShipError("AUTH_REQUIRED", "Bearer token required");
  tokenManager.authenticate(match[1]!, { requiredScope: scope });
}
