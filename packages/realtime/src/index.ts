export const REALTIME_PROTOCOL_VERSION = 1 as const;

const CONTROL_AUTH = "$lynxship.auth";
const CONTROL_AUTH_OK = "$lynxship.auth.ok";
const CONTROL_AUTH_ERROR = "$lynxship.auth.error";
const CONTROL_PING = "$lynxship.ping";
const CONTROL_PONG = "$lynxship.pong";
const CONTROL_TYPES = new Set([
  CONTROL_AUTH,
  CONTROL_AUTH_OK,
  CONTROL_AUTH_ERROR,
  CONTROL_PING,
  CONTROL_PONG,
]);

const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_MAX_QUEUE_MESSAGES = 100;
const DEFAULT_MAX_QUEUE_BYTES = 512 * 1024;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_JITTER = 0.2;

type Timer = ReturnType<typeof setTimeout>;

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
    | "SOCKET_ERROR";

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

type QueuedMessage = {
  serialized: string;
  bytes: number;
};

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function assertJsonValue(
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

function utf8ByteLength(value: string): number {
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

function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RealtimeError(
      "INVALID_CONFIGURATION",
      `${name} must be a positive integer`,
    );
  return value;
}

function validateUrl(value: string): void {
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

function validateMessageType(type: string): void {
  if (!/^[a-z][a-z0-9._:-]{0,63}$/.test(type) || CONTROL_TYPES.has(type))
    throw new RealtimeError(
      "INVALID_MESSAGE",
      "Message type is invalid or reserved",
    );
}

function newId(now: () => number, random: () => number): string {
  const suffix = Math.floor(
    Math.max(0, Math.min(0.999999, random())) * 1_000_000,
  )
    .toString(36)
    .padStart(4, "0");
  return `${Math.floor(now()).toString(36)}-${suffix}`;
}

function defaultRandom(): number {
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

async function defaultSocket(
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

export class RealtimeClient {
  private readonly options: Required<
    Pick<
      RealtimeOptions,
      | "maxMessageBytes"
      | "maxQueueMessages"
      | "maxQueueBytes"
      | "connectionTimeoutMs"
      | "heartbeatIntervalMs"
      | "heartbeatTimeoutMs"
    >
  > &
    RealtimeOptions;

  private state: RealtimeState = "idle";

  private authenticated = false;

  private socket: RealtimeSocket | null = null;

  private queue: QueuedMessage[] = [];

  private queuedBytes = 0;

  private reconnectAttempt = 0;

  private reconnectTimer: Timer | null = null;

  private connectionTimer: Timer | null = null;

  private heartbeatTimer: Timer | null = null;

  private heartbeatTimeoutTimer: Timer | null = null;

  private manuallyClosed = false;

  private messageSequence = 0;

  private readonly messageListeners = new Set<RealtimeMessageListener>();

  constructor(options: RealtimeOptions) {
    validateUrl(options.url);
    if (!options.allowAnonymous && options.token === undefined)
      throw new RealtimeError(
        "INVALID_CONFIGURATION",
        "A token provider is required unless allowAnonymous is true",
      );
    if (
      options.token !== undefined &&
      typeof options.token === "string" &&
      options.token.length === 0
    )
      throw new RealtimeError(
        "INVALID_CONFIGURATION",
        "Token must not be empty",
      );
    this.options = {
      ...options,
      maxMessageBytes: validatePositiveInteger(
        options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
        "maxMessageBytes",
      ),
      maxQueueMessages: validatePositiveInteger(
        options.maxQueueMessages ?? DEFAULT_MAX_QUEUE_MESSAGES,
        "maxQueueMessages",
      ),
      maxQueueBytes: validatePositiveInteger(
        options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES,
        "maxQueueBytes",
      ),
      connectionTimeoutMs: validatePositiveInteger(
        options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
        "connectionTimeoutMs",
      ),
      heartbeatIntervalMs: validatePositiveInteger(
        options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
        "heartbeatIntervalMs",
      ),
      heartbeatTimeoutMs: validatePositiveInteger(
        options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
        "heartbeatTimeoutMs",
      ),
    };
  }

  getSnapshot(): RealtimeSnapshot {
    return {
      state: this.state,
      authenticated: this.authenticated,
      reconnectAttempt: this.reconnectAttempt,
      queuedMessages: this.queue.length,
      queuedBytes: this.queuedBytes,
    };
  }

  /** Subscribe to application envelopes without replacing the constructor callback. */
  subscribe(listener: RealtimeMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async connect(): Promise<void> {
    this.manuallyClosed = false;
    if (this.state === "open" || this.state === "connecting") return;
    this.clearReconnectTimer();
    this.setState("connecting");
    this.authenticated = false;
    try {
      const socket = await (this.options.createSocket
        ? this.options.createSocket(this.options.url, this.options.protocols)
        : defaultSocket(this.options.url, this.options.protocols));
      if (this.manuallyClosed) {
        socket.close(1000, "Client closed");
        return;
      }
      this.socket = socket;
      socket.onopen = () => {
        void this.handleOpen();
      };
      socket.onmessage = (event) => {
        this.handleMessage(event);
      };
      socket.onerror = (event) => {
        this.emitError(
          new RealtimeError("SOCKET_ERROR", "Realtime socket error"),
        );
      };
      socket.onclose = (event) => {
        this.handleClose(event);
      };
      this.connectionTimer = setTimeout(() => {
        this.emitError(
          new RealtimeError(
            "CONNECTION_TIMEOUT",
            "Realtime connection timed out",
          ),
        );
        this.closeSocket(4008, "Connection timeout");
      }, this.options.connectionTimeoutMs);
    } catch (error) {
      this.handleConnectFailure(error);
    }
  }

  close(code = 1000, reason = "Client closed"): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.clearTimers();
    if (!this.socket) {
      this.authenticated = false;
      this.setState("closed");
      return;
    }
    this.setState("closing");
    this.socket.close(code, reason);
  }

  send<T extends JsonValue>(type: string, payload: T): string {
    if (this.manuallyClosed)
      throw new RealtimeError(
        "SOCKET_ERROR",
        "Realtime client was closed by the caller",
      );
    validateMessageType(type);
    assertJsonValue(payload);
    const id = `${newId(this.options.now ?? Date.now, this.options.random ?? defaultRandom)}-${this.messageSequence++}`;
    const envelope: RealtimeEnvelope<T> = {
      v: REALTIME_PROTOCOL_VERSION,
      type,
      id,
      ts: this.now(),
      payload,
    };
    const serialized = JSON.stringify(envelope);
    const bytes = utf8ByteLength(serialized);
    if (bytes > this.options.maxMessageBytes)
      throw new RealtimeError(
        "MESSAGE_TOO_LARGE",
        "Realtime message exceeds the configured size limit",
      );
    if (this.state === "open" && this.authenticated)
      this.sendSerialized(serialized);
    else this.enqueue({ serialized, bytes });
    return id;
  }

  private async handleOpen(): Promise<void> {
    this.clearTimer("connection");
    this.reconnectAttempt = 0;
    this.setState("open");
    try {
      const token = await this.resolveToken();
      if (this.manuallyClosed) return;
      this.sendControl(CONTROL_AUTH, { token });
      this.connectionTimer = setTimeout(() => {
        this.emitError(
          new RealtimeError(
            "AUTHENTICATION_FAILED",
            "Realtime authentication timed out",
          ),
        );
        this.closeSocket(4003, "Authentication timeout");
      }, this.options.connectionTimeoutMs);
    } catch (error) {
      this.emitError(
        error instanceof RealtimeError
          ? error
          : new RealtimeError(
              "AUTHENTICATION_FAILED",
              "Could not resolve realtime credentials",
              { cause: error },
            ),
      );
      this.closeSocket(4003, "Authentication failed");
    }
  }

  private handleMessage(event: RealtimeSocketMessageEvent): void {
    if (typeof event.data !== "string") {
      this.protocolFailure("Binary realtime frames are not supported");
      return;
    }
    if (utf8ByteLength(event.data) > this.options.maxMessageBytes) {
      this.protocolFailure("Realtime frame exceeds the configured size limit");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(event.data) as unknown;
    } catch (error) {
      this.protocolFailure("Realtime frame is not valid JSON", error);
      return;
    }
    const envelope = this.parseEnvelope(value);
    if (!envelope) return;
    switch (envelope.type) {
      case CONTROL_AUTH_OK:
        this.handleAuthenticated();
        return;
      case CONTROL_AUTH_ERROR:
        this.emitError(
          new RealtimeError(
            "AUTHENTICATION_FAILED",
            "Realtime server rejected authentication",
          ),
        );
        this.closeSocket(4003, "Authentication rejected");
        return;
      case CONTROL_PING:
        if (this.state === "open") {
          try {
            this.sendControl(CONTROL_PONG, { clientTime: this.now() });
          } catch (error) {
            this.emitError(
              error instanceof RealtimeError
                ? error
                : new RealtimeError(
                    "SOCKET_ERROR",
                    "Realtime pong could not be sent",
                    { cause: error },
                  ),
            );
            this.closeSocket(4008, "Pong failed");
          }
        }
        return;
      case CONTROL_PONG:
        this.clearTimer("heartbeatTimeout");
        return;
      default:
        if (envelope.type.startsWith("$")) {
          this.protocolFailure("Unknown reserved realtime message type");
          return;
        }
        if (!this.authenticated) {
          this.protocolFailure(
            "Server sent an application message before authentication",
          );
          return;
        }
        try {
          validateMessageType(envelope.type);
        } catch (error) {
          this.protocolFailure("Application message type is invalid", error);
          return;
        }
        this.options.onMessage?.(envelope);
        for (const listener of this.messageListeners) listener(envelope);
    }
  }

  private handleAuthenticated(): void {
    this.clearTimer("connection");
    this.authenticated = true;
    this.setState("open");
    this.startHeartbeat();
    this.options.onReady?.();
    this.flushQueue();
  }

  private handleClose(event: RealtimeCloseInfo): void {
    this.clearTimers();
    this.socket = null;
    this.authenticated = false;
    this.setState("closed");
    if (!this.manuallyClosed && this.shouldReconnect(event.code))
      this.scheduleReconnect();
  }

  private handleConnectFailure(error: unknown): void {
    this.clearTimers();
    this.socket = null;
    this.authenticated = false;
    this.setState("closed");
    this.emitError(
      error instanceof RealtimeError
        ? error
        : new RealtimeError("SOCKET_ERROR", "Realtime connection failed", {
            cause: error,
          }),
    );
    if (!this.manuallyClosed) this.scheduleReconnect();
  }

  private parseEnvelope(value: unknown): RealtimeEnvelope | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.protocolFailure("Realtime frame must be an object");
      return null;
    }
    const candidate = value as Record<string, unknown>;
    if (
      candidate.v !== REALTIME_PROTOCOL_VERSION ||
      typeof candidate.type !== "string" ||
      typeof candidate.id !== "string" ||
      typeof candidate.ts !== "number" ||
      !Number.isSafeInteger(candidate.ts)
    ) {
      this.protocolFailure("Realtime frame has an invalid envelope");
      return null;
    }
    if (
      candidate.id.length === 0 ||
      candidate.id.length > 128 ||
      !/^[A-Za-z0-9_.:-]+$/.test(candidate.id)
    ) {
      this.protocolFailure("Realtime frame has an invalid id");
      return null;
    }
    if (candidate.type.startsWith("$") && !CONTROL_TYPES.has(candidate.type)) {
      this.protocolFailure("Realtime frame uses an unknown reserved type");
      return null;
    }
    try {
      assertJsonValue(candidate.payload);
    } catch (error) {
      this.protocolFailure("Realtime frame payload is invalid", error);
      return null;
    }
    return candidate as unknown as RealtimeEnvelope;
  }

  private async resolveToken(): Promise<string | null> {
    if (this.options.allowAnonymous && this.options.token === undefined)
      return null;
    if (this.options.token === undefined)
      throw new RealtimeError(
        "AUTHENTICATION_REQUIRED",
        "Realtime authentication token is missing",
      );
    const token =
      typeof this.options.token === "function"
        ? await this.options.token()
        : this.options.token;
    if (!token || token.length > 4096)
      throw new RealtimeError(
        "AUTHENTICATION_REQUIRED",
        "Realtime authentication token is invalid",
      );
    return token;
  }

  private sendControl(type: string, payload: JsonValue): void {
    const envelope: RealtimeEnvelope = {
      v: REALTIME_PROTOCOL_VERSION,
      type,
      id: `${newId(this.options.now ?? Date.now, this.options.random ?? defaultRandom)}-${this.messageSequence++}`,
      ts: this.now(),
      payload,
    };
    const serialized = JSON.stringify(envelope);
    if (utf8ByteLength(serialized) > this.options.maxMessageBytes) {
      this.protocolFailure("Control frame exceeds the configured size limit");
      return;
    }
    this.sendSerialized(serialized);
  }

  private sendSerialized(serialized: string): void {
    if (!this.socket || this.state !== "open") {
      throw new RealtimeError("SOCKET_ERROR", "Realtime socket is not open");
    }
    try {
      this.socket.send(serialized);
    } catch (error) {
      throw new RealtimeError(
        "SOCKET_ERROR",
        "Realtime message could not be sent",
        { cause: error },
      );
    }
  }

  private enqueue(message: QueuedMessage): void {
    if (
      this.queue.length >= this.options.maxQueueMessages ||
      this.queuedBytes + message.bytes > this.options.maxQueueBytes
    )
      throw new RealtimeError("QUEUE_FULL", "Realtime outbound queue is full");
    this.queue.push(message);
    this.queuedBytes += message.bytes;
  }

  private flushQueue(): void {
    try {
      while (
        this.queue.length > 0 &&
        this.socket &&
        this.state === "open" &&
        this.authenticated
      ) {
        const message = this.queue.shift();
        if (!message) break;
        this.queuedBytes -= message.bytes;
        this.sendSerialized(message.serialized);
      }
    } catch (error) {
      this.emitError(
        error instanceof RealtimeError
          ? error
          : new RealtimeError(
              "SOCKET_ERROR",
              "Queued realtime messages could not be sent",
              { cause: error },
            ),
      );
      this.closeSocket(4008, "Queue flush failed");
    }
  }

  private startHeartbeat(): void {
    this.clearTimer("heartbeat");
    this.heartbeatTimer = setTimeout(() => {
      if (this.state !== "open" || !this.authenticated) return;
      try {
        this.sendControl(CONTROL_PING, { clientTime: this.now() });
      } catch (error) {
        this.emitError(
          error instanceof RealtimeError
            ? error
            : new RealtimeError(
                "SOCKET_ERROR",
                "Realtime heartbeat could not be sent",
                { cause: error },
              ),
        );
        this.closeSocket(4008, "Heartbeat failed");
        return;
      }
      this.heartbeatTimeoutTimer = setTimeout(() => {
        this.emitError(
          new RealtimeError(
            "HEARTBEAT_TIMEOUT",
            "Realtime heartbeat timed out",
          ),
        );
        this.closeSocket(4008, "Heartbeat timeout");
      }, this.options.heartbeatTimeoutMs);
      this.startHeartbeat();
    }, this.options.heartbeatIntervalMs);
  }

  private closeSocket(code: number, reason: string): void {
    if (!this.socket) return;
    this.clearTimers();
    this.setState("closing");
    this.socket.close(code, reason);
  }

  private protocolFailure(message: string, cause?: unknown): void {
    this.emitError(
      new RealtimeError(
        "PROTOCOL_ERROR",
        message,
        cause ? { cause } : undefined,
      ),
    );
    this.closeSocket(1002, "Protocol error");
  }

  private shouldReconnect(code: number): boolean {
    if (
      code === 1000 ||
      code === 1002 ||
      code === 1003 ||
      code === 1007 ||
      code === 1008 ||
      code === 1009 ||
      code === 4003
    )
      return false;
    const reconnect = this.options.reconnect;
    return (
      reconnect?.enabled !== false &&
      this.reconnectAttempt < (reconnect?.maxAttempts ?? 8)
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const reconnect = this.options.reconnect;
    if (reconnect?.enabled === false) return;
    const base = Math.max(
      1,
      reconnect?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
    );
    const maximum = Math.max(
      base,
      reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
    );
    const jitter = Math.max(
      0,
      Math.min(1, reconnect?.jitterRatio ?? DEFAULT_RECONNECT_JITTER),
    );
    const delay = Math.min(maximum, base * 2 ** this.reconnectAttempt);
    const factor =
      1 - jitter + (this.options.random ?? defaultRandom)() * jitter * 2;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        void this.connect();
      },
      Math.max(1, Math.floor(delay * factor)),
    );
  }

  private setState(state: RealtimeState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private emitError(error: RealtimeError): void {
    this.options.onError?.(error);
  }

  private now(): number {
    return Math.floor((this.options.now ?? Date.now)());
  }

  private clearTimer(
    name: "connection" | "heartbeat" | "heartbeatTimeout",
  ): void {
    const timerName = `${name}Timer` as
      | "connectionTimer"
      | "heartbeatTimer"
      | "heartbeatTimeoutTimer";
    const timer = this[timerName];
    if (timer) clearTimeout(timer);
    this[timerName] = null;
  }

  private clearTimers(): void {
    this.clearTimer("connection");
    this.clearTimer("heartbeat");
    this.clearTimer("heartbeatTimeout");
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

export function createRealtimeClient(options: RealtimeOptions): RealtimeClient {
  return new RealtimeClient(options);
}

export {
  PRESENCE_PROTOCOL_VERSION,
  PresenceClient,
  createPresenceClient,
  type PresenceAppState,
  type PresenceEvent,
  type PresenceKind,
  type PresenceLifecycleSource,
  type PresenceOptions,
  type PresenceSnapshot,
  type PresenceConversationSnapshot,
  type PresenceParticipant,
  type PresenceProfile,
  type PresenceProfileUpdate,
  type PresenceStateStoreOptions,
  PresenceStateStore,
  PresenceActivityNotifier,
  type PresenceActivityNotification,
  type PresenceActivityNotificationOptions,
} from "./presence.js";

export {
  RECEIPT_PROTOCOL_VERSION,
  InMemoryReadReceiptStore,
  ReadReceiptClient,
  createReadReceiptClient,
  type ReadReceiptEvent,
  type ReadReceiptKind,
  type ReadReceiptMessageSnapshot,
  type ReadReceiptOptions,
  type ReadReceiptStore,
  type ReadReceiptStoreOptions,
} from "./receipts.js";

export {
  ActivityStack,
  PresenceActivityStack,
  type ActivityStackEntry,
  type ActivityStackItem,
  type ActivityStackOptions,
  type ActivityStackSnapshot,
} from "./activity-stack.js";
