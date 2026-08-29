export const REALTIME_PROTOCOL_VERSION = 1 as const;

export const CONTROL_AUTH = "$lynxship.auth";

export const CONTROL_AUTH_OK = "$lynxship.auth.ok";

export const CONTROL_AUTH_ERROR = "$lynxship.auth.error";

export const CONTROL_PING = "$lynxship.ping";

export const CONTROL_PONG = "$lynxship.pong";

export const CONTROL_TYPES = new Set([
  CONTROL_AUTH,
  CONTROL_AUTH_OK,
  CONTROL_AUTH_ERROR,
  CONTROL_PING,
  CONTROL_PONG,
]);

export const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;

export const DEFAULT_MAX_QUEUE_MESSAGES = 100;

export const DEFAULT_MAX_QUEUE_BYTES = 512 * 1024;

export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

export const DEFAULT_RECONNECT_BASE_DELAY_MS = 500;

export const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;

export const DEFAULT_RECONNECT_JITTER = 0.2;

export type Timer = ReturnType<typeof setTimeout>;

export type RealtimeState =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "closing";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RealtimeEnvelope<T extends JsonValue = JsonValue> {
  v: typeof REALTIME_PROTOCOL_VERSION;
  type: string;
  id: string;
  ts: number;
  payload: T;
}

export interface RealtimeCloseInfo {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface RealtimeSocketMessageEvent {
  data: string | ArrayBuffer;
}

export interface RealtimeSocketErrorEvent {
  message?: string;
}

export interface RealtimeSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: RealtimeSocketMessageEvent) => void) | null;
  onerror: ((event: RealtimeSocketErrorEvent) => void) | null;
  onclose: ((event: RealtimeCloseInfo) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RealtimeSocketConstructor {
  new (url: string, protocols?: string | string[]): RealtimeSocket;
}

export type TokenProvider =
  | string
  | (() => string | null | Promise<string | null>);

export interface RealtimeReconnectOptions {
  enabled?: boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

export interface RealtimeOptions {
  url: string;
  token?: TokenProvider;
  allowAnonymous?: boolean;
  protocols?: string | string[];
  maxMessageBytes?: number;
  maxQueueMessages?: number;
  maxQueueBytes?: number;
  connectionTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  reconnect?: RealtimeReconnectOptions;
  createSocket?: (
    url: string,
    protocols: string | string[] | undefined,
  ) => RealtimeSocket;
  now?: () => number;
  random?: () => number;
  onStateChange?: (state: RealtimeState) => void;
  onReady?: () => void;
  onMessage?: (message: RealtimeEnvelope) => void;
  onError?: (error: RealtimeError) => void;
}

export type RealtimeMessageListener = (message: RealtimeEnvelope) => void;

export interface RealtimeSnapshot {
  state: RealtimeState;
  authenticated: boolean;
  reconnectAttempt: number;
  queuedMessages: number;
  queuedBytes: number;
}

export class RealtimeError extends Error {
  readonly code:
    | "INVALID_CONFIGURATION"
    | "INVALID_URL"
    | "NO_WEBSOCKET_RUNTIME"
    | "AUTHENTICATION_REQUIRED"
    | "AUTHENTICATION_FAILED"
    | "MESSAGE_TOO_LARGE"
    | "QUEUE_FULL"
    | "INVALID_MESSAGE"
    | "PROTOCOL_ERROR"
    | "CONNECTION_TIMEOUT"
    | "HEARTBEAT_TIMEOUT"
    | "SOCKET_ERROR"
    | "CALLBACK_ERROR";

  constructor(
    code: RealtimeError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RealtimeError";
    this.code = code;
  }
}

export type QueuedMessage = {
  serialized: string;
  bytes: number;
};

export function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function assertJsonValue(
  value: unknown,
  depth = 0,
): asserts value is JsonValue {
  if (depth > 32)
    throw new RealtimeError("INVALID_MESSAGE", "Payload is too deeply nested");
  if (isJsonPrimitive(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) {
    throw new RealtimeError(
      "INVALID_MESSAGE",
      "Payload must contain JSON values only",
    );
  }
  for (const [key, item] of Object.entries(value)) {
    if (key.length > 128)
      throw new RealtimeError("INVALID_MESSAGE", "Payload key is too long");
    assertJsonValue(item, depth + 1);
  }
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RealtimeError(
      "INVALID_CONFIGURATION",
      `${name} must be a positive integer`,
    );
  return value;
}

export function validateUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new RealtimeError("INVALID_URL", "Realtime URL is invalid", {
      cause: error,
    });
  }
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:")
    throw new RealtimeError("INVALID_URL", "Realtime URL must use wss://");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const local =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "10.0.2.2";
  if (parsed.protocol === "ws:" && !local)
    throw new RealtimeError(
      "INVALID_URL",
      "Production realtime connections must use wss://",
    );
  if (parsed.username || parsed.password)
    throw new RealtimeError(
      "INVALID_URL",
      "Credentials in the realtime URL are not allowed",
    );
  if (/[?&](?:token|access_token|authorization)=/i.test(parsed.search))
    throw new RealtimeError(
      "INVALID_URL",
      "Credentials must not be placed in the URL",
    );
}

export function validateMessageType(type: string): void {
  if (!/^[a-z][a-z0-9._:-]{0,63}$/.test(type) || CONTROL_TYPES.has(type))
    throw new RealtimeError(
      "INVALID_MESSAGE",
      "Message type is invalid or reserved",
    );
}

export function newId(now: () => number, random: () => number): string {
  const suffix = Math.floor(
    Math.max(0, Math.min(0.999999, random())) * 1_000_000,
  )
    .toString(36)
    .padStart(4, "0");
  return `${Math.floor(now()).toString(36)}-${suffix}`;
}

export function defaultRandom(): number {
  const cryptoObject = (
    globalThis as {
      crypto?: { getRandomValues?: (value: Uint32Array) => Uint32Array };
    }
  ).crypto;
  if (cryptoObject?.getRandomValues) {
    const value = cryptoObject.getRandomValues(new Uint32Array(1))[0] ?? 0;
    return value / 0xffffffff;
  }
  return Math.random();
}

export async function defaultSocket(
  url: string,
  protocols: string | string[] | undefined,
): Promise<RealtimeSocket> {
  const globalConstructor = (
    globalThis as { WebSocket?: RealtimeSocketConstructor }
  ).WebSocket;
  if (globalConstructor) return new globalConstructor(url, protocols);
  try {
    const module = await import("@lynx-js/websocket");
    return new module.WebSocket(url, protocols) as unknown as RealtimeSocket;
  } catch (error) {
    throw new RealtimeError(
      "NO_WEBSOCKET_RUNTIME",
      "No WebSocket runtime is available; use Lynx with @lynx-js/websocket or inject createSocket",
      { cause: error },
    );
  }
}
