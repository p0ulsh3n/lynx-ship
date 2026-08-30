export type BridgePrimitive = string | number | boolean | null;

export type BridgeValue =
  | BridgePrimitive
  | readonly BridgeValue[]
  | { readonly [key: string]: BridgeValue };

/** Canonical response envelope returned by a Lynx native transport. */
export interface BridgeNativeResponse {
  readonly code: number;
  readonly msg: string;
  readonly data?: BridgeValue;
}

/** The native bridge response code that resolves a JavaScript call. */
export const BRIDGE_SUCCESS_CODE = 1;

export interface BridgeMethod {
  readonly name: string;
  readonly version?: string;
  readonly capability?: string;
  readonly permissions?: readonly string[];
  readonly thread?: "main" | "background";
  readonly timeoutMs?: number;
  readonly maxPayloadBytes?: number;
}

export interface BridgeCallOptions {
  readonly idempotencyKey?: string;
  /** Optional per-call timeout override, bounded by the validator. */
  readonly timeoutMs?: number;
  /** Scheduling hint for transports that support prioritization. */
  readonly priority?: BridgePriority;
  /** Retries are opt-in and require an idempotency key for safety. */
  readonly retry?: BridgeRetryOptions;
}

export type BridgePriority = "high" | "normal" | "low";

export interface BridgeRetryOptions {
  readonly maxAttempts?: number;
  readonly delayMs?: number;
}

export interface BridgeInvocationContext {
  readonly requestId: string;
  readonly idempotencyKey?: string;
  readonly version?: string;
  readonly thread?: "main" | "background";
  readonly attempt?: number;
  readonly priority?: BridgePriority;
}

export interface BridgeTransport {
  invoke(
    method: string,
    args: BridgeValue,
    signal: AbortSignal,
    context?: BridgeInvocationContext,
  ): Promise<BridgeValue>;
  subscribe?(
    event: string,
    listener: (payload: BridgeValue) => void,
  ): () => void;
}

export interface BridgeClient {
  call(
    method: string,
    args: BridgeValue,
    options?: BridgeCallOptions,
  ): Promise<BridgeValue>;
  callWithTimeout(
    method: string,
    args: BridgeValue,
    timeoutMs: number,
    options?: Omit<BridgeCallOptions, "timeoutMs">,
  ): Promise<BridgeValue>;
  subscribe(
    event: string,
    listener: (payload: BridgeValue) => void,
  ): () => void;
  methods(): readonly BridgeMethod[];
  dispose(): void;
}

export interface BridgeOptions {
  readonly transport: BridgeTransport;
  readonly methods: readonly BridgeMethod[];
  readonly events?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly permissions?: readonly string[];
  readonly createRequestId?: () => string;
  readonly defaultTimeoutMs?: number;
  readonly maxPayloadBytes?: number;
}
