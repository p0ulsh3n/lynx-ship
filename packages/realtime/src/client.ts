import {
  CONTROL_AUTH,
  CONTROL_AUTH_ERROR,
  CONTROL_AUTH_OK,
  CONTROL_PING,
  CONTROL_PONG,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_QUEUE_BYTES,
  DEFAULT_MAX_QUEUE_MESSAGES,
  REALTIME_PROTOCOL_VERSION,
  RealtimeError,
  assertJsonValue,
  defaultRandom,
  defaultSocket,
  newId,
  utf8ByteLength,
  validateMessageType,
  validatePositiveInteger,
  validateUrl,
  type JsonValue,
  type RealtimeCloseInfo,
  type RealtimeEnvelope,
  type RealtimeMessageListener,
  type RealtimeOptions,
  type RealtimeSnapshot,
  type RealtimeSocket,
  type RealtimeSocketMessageEvent,
  type RealtimeState,
  type Timer,
  type QueuedMessage,
} from "./client/core.js";
import { parseRealtimeEnvelope } from "./client/protocol.js";
import { reconnectDelay, shouldReconnect } from "./client/reconnect.js";
import { serializeControlFrame } from "./client/control.js";
import { sendRealtimeSerialized } from "./client/transport.js";
import { resolveRealtimeToken } from "./client/auth.js";
import {
  emitRealtimeError,
  invokeRealtimeCallback,
} from "./client/callbacks.js";

export * from "./client/core.js";

// Intentional facade exception: this public client owns one socket lifecycle
// state machine. Protocol parsing and retry policy remain in client/* modules.
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
        if (this.socket !== socket) return;
        void this.handleOpen(socket);
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        this.handleMessage(event);
      };
      socket.onerror = () => {
        if (this.socket !== socket) return;
        emitRealtimeError(
          this.options.onError,
          new RealtimeError("SOCKET_ERROR", "Realtime socket error"),
        );
      };
      socket.onclose = (event) => {
        if (this.socket !== socket) return;
        this.handleClose(event);
      };
      this.connectionTimer = setTimeout(() => {
        if (this.socket !== socket) return;
        emitRealtimeError(
          this.options.onError,
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
      sendRealtimeSerialized(this.socket, this.state, serialized);
    else this.enqueue({ serialized, bytes });
    return id;
  }

  private async handleOpen(socket: RealtimeSocket): Promise<void> {
    if (this.socket !== socket) return;
    this.clearTimer("connection");
    this.reconnectAttempt = 0;
    this.setState("open");
    try {
      const token = await resolveRealtimeToken(this.options);
      if (this.manuallyClosed || this.socket !== socket) return;
      this.sendControl(CONTROL_AUTH, { token });
      this.connectionTimer = setTimeout(() => {
        if (this.socket !== socket) return;
        emitRealtimeError(
          this.options.onError,
          new RealtimeError(
            "AUTHENTICATION_FAILED",
            "Realtime authentication timed out",
          ),
        );
        this.closeSocket(4003, "Authentication timeout");
      }, this.options.connectionTimeoutMs);
    } catch (error) {
      emitRealtimeError(
        this.options.onError,
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
        emitRealtimeError(
          this.options.onError,
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
            emitRealtimeError(
              this.options.onError,
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
        if (this.options.onMessage)
          invokeRealtimeCallback(
            () => this.options.onMessage!(envelope),
            "onMessage",
            this.options.onError,
          );
        for (const listener of this.messageListeners)
          invokeRealtimeCallback(
            () => listener(envelope),
            "subscribe",
            this.options.onError,
          );
    }
  }

  private handleAuthenticated(): void {
    this.clearTimer("connection");
    this.authenticated = true;
    this.setState("open");
    this.startHeartbeat();
    if (this.options.onReady)
      invokeRealtimeCallback(
        this.options.onReady,
        "onReady",
        this.options.onError,
      );
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
    emitRealtimeError(
      this.options.onError,
      error instanceof RealtimeError
        ? error
        : new RealtimeError("SOCKET_ERROR", "Realtime connection failed", {
            cause: error,
          }),
    );
    if (!this.manuallyClosed) this.scheduleReconnect();
  }

  private parseEnvelope(value: unknown): RealtimeEnvelope | null {
    return parseRealtimeEnvelope(value, (message, cause) =>
      this.protocolFailure(message, cause),
    );
  }

  private sendControl(type: string, payload: JsonValue): void {
    const frame = serializeControlFrame({
      type,
      payload,
      now: () => this.now(),
      random: this.options.random,
      sequence: this.messageSequence,
      maxBytes: this.options.maxMessageBytes,
    });
    if (!frame) {
      this.protocolFailure("Control frame exceeds the configured size limit");
      return;
    }
    this.messageSequence = frame.nextSequence;
    sendRealtimeSerialized(this.socket, this.state, frame.serialized);
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
        sendRealtimeSerialized(this.socket, this.state, message.serialized);
      }
    } catch (error) {
      emitRealtimeError(
        this.options.onError,
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
        emitRealtimeError(
          this.options.onError,
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
        emitRealtimeError(
          this.options.onError,
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
    emitRealtimeError(
      this.options.onError,
      new RealtimeError(
        "PROTOCOL_ERROR",
        message,
        cause ? { cause } : undefined,
      ),
    );
    this.closeSocket(1002, "Protocol error");
  }

  private shouldReconnect(code: number): boolean {
    return shouldReconnect(code, this.options.reconnect, this.reconnectAttempt);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.options.reconnect?.enabled === false) return;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        void this.connect();
      },
      reconnectDelay(
        this.options.reconnect,
        this.reconnectAttempt - 1,
        this.options.random ?? defaultRandom,
      ),
    );
  }

  private setState(state: RealtimeState): void {
    this.state = state;
    if (this.options.onStateChange)
      invokeRealtimeCallback(
        () => this.options.onStateChange!(state),
        "onStateChange",
        this.options.onError,
      );
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
