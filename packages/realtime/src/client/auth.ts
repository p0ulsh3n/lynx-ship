import { RealtimeError, type RealtimeOptions } from "./core.js";

export async function resolveRealtimeToken(
  options: Pick<RealtimeOptions, "allowAnonymous" | "token">,
): Promise<string | null> {
  if (options.allowAnonymous && options.token === undefined) return null;
  if (options.token === undefined)
    throw new RealtimeError(
      "AUTHENTICATION_REQUIRED",
      "Realtime authentication token is missing",
    );
  const token =
    typeof options.token === "function" ? await options.token() : options.token;
  if (!token || token.length > 4096)
    throw new RealtimeError(
      "AUTHENTICATION_REQUIRED",
      "Realtime authentication token is invalid",
    );
  return token;
}
