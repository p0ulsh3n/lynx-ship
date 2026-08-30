import type {
  BridgeCallOptions,
  BridgeClient,
  BridgeMethod,
  BridgeValue,
} from "./contracts.js";
import { BridgeError } from "./errors.js";

/** The compile-time shape of one typed native method. */
export interface TypedBridgeMethod<
  Params extends BridgeValue = BridgeValue,
  Result extends BridgeValue = BridgeValue,
> {
  readonly descriptor: BridgeMethod;
  /** Optional runtime validation generated or supplied by the method author. */
  readonly validateParams?: (value: BridgeValue) => value is Params;
  /** Optional runtime validation generated or supplied by the method author. */
  readonly validateResult?: (value: BridgeValue) => value is Result;
}

/** The compile-time and runtime shape of one typed native event. */
export interface TypedBridgeEvent<Payload extends BridgeValue = BridgeValue> {
  /** Optional runtime validator supplied by the event author. */
  readonly validatePayload?: (value: BridgeValue) => value is Payload;
}

/** A map used to infer parameter and result types for a method package. */
export type TypedBridgeMap = Readonly<
  Record<string, { readonly params: BridgeValue; readonly result: BridgeValue }>
>;

export type TypedBridgeDefinitions<M extends TypedBridgeMap> = {
  readonly [K in keyof M & string]: TypedBridgeMethod<
    M[K]["params"],
    M[K]["result"]
  >;
};

/** A map used to infer payload types for native events. */
export type TypedBridgeEventMap = Readonly<
  Record<string, { readonly payload: BridgeValue }>
>;

export type TypedBridgeEventDefinitions<E extends TypedBridgeEventMap> = {
  readonly [K in keyof E & string]: TypedBridgeEvent<E[K]["payload"]>;
};

export interface TypedBridgeClient<
  M extends TypedBridgeMap,
  E extends TypedBridgeEventMap = TypedBridgeEventMap,
> {
  call<K extends keyof M & string>(
    method: K,
    params: M[K]["params"],
    options?: BridgeCallOptions,
  ): Promise<M[K]["result"]>;
  subscribe<K extends keyof E & string>(
    event: K,
    listener: (payload: E[K]["payload"]) => void,
  ): () => void;
  methods(): readonly BridgeMethod[];
  dispose(): void;
}

/**
 * Creates a typed method facade over the existing policy-enforcing bridge.
 *
 * The native transport remains the single execution boundary. This helper
 * only adds compile-time method maps and optional runtime codecs; it cannot
 * bypass the underlying allowlist, permissions, timeouts or payload limits.
 */
export function createTypedBridge<M extends TypedBridgeMap>(
  client: BridgeClient,
  definitions: TypedBridgeDefinitions<M>,
): TypedBridgeClient<M>;

export function createTypedBridge<
  M extends TypedBridgeMap,
  E extends TypedBridgeEventMap,
>(
  client: BridgeClient,
  definitions: TypedBridgeDefinitions<M>,
  options: { readonly events: TypedBridgeEventDefinitions<E> },
): TypedBridgeClient<M, E>;

export function createTypedBridge<
  M extends TypedBridgeMap,
  E extends TypedBridgeEventMap,
>(
  client: BridgeClient,
  definitions: TypedBridgeDefinitions<M>,
  options: { readonly events?: TypedBridgeEventDefinitions<E> },
): TypedBridgeClient<M, E>;

export function createTypedBridge<
  M extends TypedBridgeMap,
  E extends TypedBridgeEventMap = TypedBridgeEventMap,
>(
  client: BridgeClient,
  definitions: TypedBridgeDefinitions<M>,
  options: { readonly events?: TypedBridgeEventDefinitions<E> } = {},
): TypedBridgeClient<M, E> {
  const rawMethods = new Map(
    client.methods().map((method) => [method.name, method]),
  );
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.descriptor.name !== name)
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "A typed bridge key must match its method descriptor name.",
        { method: name, descriptor: definition.descriptor.name },
      );
    const raw = rawMethods.get(name);
    if (!raw || !sameDescriptor(raw, definition.descriptor))
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "The typed bridge descriptor does not match the raw bridge manifest.",
        { method: name },
      );
  }
  const getDefinition = (method: string): TypedBridgeMethod => {
    const definition = definitions[method as keyof M & string];
    if (!definition)
      throw new BridgeError(
        "BRIDGE_METHOD_DENIED",
        "The typed bridge method is not declared.",
        { method },
      );
    return definition;
  };

  return {
    async call<K extends keyof M & string>(
      method: K,
      params: M[K]["params"],
      options?: BridgeCallOptions,
    ): Promise<M[K]["result"]> {
      const definition = getDefinition(method);
      if (
        definition.validateParams &&
        !definition.validateParams(params as BridgeValue)
      )
        throw new BridgeError(
          "BRIDGE_INVALID_CONTRACT",
          "The typed bridge parameters do not match the method contract.",
          { method },
        );
      const result = await client.call(method, params as BridgeValue, options);
      if (definition.validateResult && !definition.validateResult(result))
        throw new BridgeError(
          "BRIDGE_INVALID_RESPONSE",
          "The native response does not match the method contract.",
          { method },
        );
      return result as M[K]["result"];
    },
    subscribe(event, listener) {
      const definition = options.events?.[event];
      return client.subscribe(event, (payload) => {
        if (definition?.validatePayload && !definition.validatePayload(payload))
          return;
        listener(payload as E[typeof event]["payload"]);
      });
    },
    methods() {
      return client.methods();
    },
    dispose() {
      client.dispose();
    },
  };
}

function sameDescriptor(left: BridgeMethod, right: BridgeMethod): boolean {
  return (
    left.name === right.name &&
    left.version === right.version &&
    left.capability === right.capability &&
    left.thread === right.thread &&
    left.timeoutMs === right.timeoutMs &&
    left.maxPayloadBytes === right.maxPayloadBytes &&
    sameStringSet(left.permissions, right.permissions)
  );
}

function sameStringSet(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const a = [...new Set(left ?? [])].sort();
  const b = [...new Set(right ?? [])].sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

export function defineTypedBridgeMethod<
  Params extends BridgeValue,
  Result extends BridgeValue,
>(
  definition: TypedBridgeMethod<Params, Result>,
): TypedBridgeMethod<Params, Result> {
  return definition;
}
