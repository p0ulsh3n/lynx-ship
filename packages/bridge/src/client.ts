import type { BridgeClient, BridgeMethod, BridgeOptions } from "./contracts.js";
import { BridgeError } from "./errors.js";
import {
  serializedBytes,
  validateEvent,
  validateBridgeCallOptions,
  validateIdempotencyKey,
  validateMethod,
  validateRequestId,
} from "./validation.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

export function createBridgeClient(options: BridgeOptions): BridgeClient {
  const sameArray = (
    left: readonly string[] | undefined,
    right: readonly string[] | undefined,
  ): boolean => JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  const methodsByName = new Map<string, BridgeMethod>();
  for (const method of options.methods) {
    validateMethod(method);
    const previous = methodsByName.get(method.name);
    if (
      previous &&
      (previous.version !== method.version ||
        previous.capability !== method.capability ||
        previous.thread !== method.thread ||
        previous.timeoutMs !== method.timeoutMs ||
        previous.maxPayloadBytes !== method.maxPayloadBytes ||
        !sameArray(previous.permissions, method.permissions))
    )
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "A bridge method is declared with conflicting limits.",
        { method: method.name },
      );
    methodsByName.set(method.name, {
      ...method,
      ...(method.permissions
        ? { permissions: [...new Set(method.permissions)] }
        : {}),
    });
  }
  const methods = [...methodsByName.values()];
  const methodMap = new Map(methods.map((method) => [method.name, method]));
  const events = unique(options.events ?? []);
  const capabilities = new Set(options.capabilities ?? []);
  const permissions = new Set(options.permissions ?? []);
  for (const value of [...capabilities, ...permissions])
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(value))
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "Bridge capabilities and permissions must be safe identifiers.",
        { value },
      );
  for (const event of events) validateEvent(event);
  if (
    options.defaultTimeoutMs !== undefined &&
    (!Number.isSafeInteger(options.defaultTimeoutMs) ||
      options.defaultTimeoutMs <= 0)
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "The default bridge timeout must be positive.",
    );
  if (
    options.maxPayloadBytes !== undefined &&
    (!Number.isSafeInteger(options.maxPayloadBytes) ||
      options.maxPayloadBytes <= 0)
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "The bridge payload limit must be positive.",
    );
  let disposed = false;
  const activeCalls = new Map<AbortController, (error: BridgeError) => void>();
  const ensureActive = (): void => {
    if (disposed)
      throw new BridgeError(
        "BRIDGE_DISPOSED",
        "The bridge client has been disposed.",
      );
  };
  return {
    async call(methodName, args, callOptions) {
      ensureActive();
      const method = methodMap.get(methodName);
      if (!method)
        throw new BridgeError(
          "BRIDGE_METHOD_DENIED",
          "The bridge method is not allow-listed.",
          {
            method: methodName,
          },
        );
      if (method.capability && !capabilities.has(method.capability))
        throw new BridgeError(
          "BRIDGE_CAPABILITY_DENIED",
          "The bridge capability required by this method is unavailable.",
          { method: methodName, capability: method.capability },
        );
      const missingPermission = (method.permissions ?? []).find(
        (permission) => !permissions.has(permission),
      );
      if (missingPermission)
        throw new BridgeError(
          "BRIDGE_PERMISSION_DENIED",
          "The bridge permission required by this method is unavailable.",
          { method: methodName, permission: missingPermission },
        );
      if (callOptions?.idempotencyKey !== undefined)
        validateIdempotencyKey(callOptions.idempotencyKey);
      validateBridgeCallOptions(callOptions);
      const payloadBytes = serializedBytes(args);
      const maxPayloadBytes =
        method.maxPayloadBytes ??
        options.maxPayloadBytes ??
        DEFAULT_MAX_PAYLOAD_BYTES;
      if (payloadBytes > maxPayloadBytes)
        throw new BridgeError(
          "BRIDGE_PAYLOAD_TOO_LARGE",
          "The bridge payload exceeds its configured limit.",
          {
            method: methodName,
            payloadBytes,
            maxPayloadBytes,
          },
        );
      const timeoutMs =
        callOptions?.timeoutMs ??
        method.timeoutMs ??
        options.defaultTimeoutMs ??
        DEFAULT_TIMEOUT_MS;
      const maxAttempts = callOptions?.retry?.maxAttempts ?? 1;
      const retryDelayMs = callOptions?.retry?.delayMs ?? 250;
      let cancel!: (error: BridgeError) => void;
      const cancellation = new Promise<never>((_resolve, reject) => {
        cancel = reject;
      });
      const requestId =
        options.createRequestId?.() ??
        `bridge_${activeCalls.size}_${Date.now()}`;
      validateRequestId(requestId);
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let controller: AbortController | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          controller = new AbortController();
          const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller?.abort();
              reject(
                new BridgeError(
                  "BRIDGE_TIMEOUT",
                  `Bridge method ${methodName} timed out.`,
                  { method: methodName, timeoutMs },
                ),
              );
            }, timeoutMs);
          });
          activeCalls.set(controller, cancel);
          const invocation = options.transport.invoke(
            methodName,
            args,
            controller.signal,
            {
              requestId,
              ...(callOptions?.idempotencyKey
                ? { idempotencyKey: callOptions.idempotencyKey }
                : {}),
              ...(method.version ? { version: method.version } : {}),
              ...(method.thread ? { thread: method.thread } : {}),
              ...(maxAttempts > 1 ? { attempt } : {}),
              ...(callOptions?.priority
                ? { priority: callOptions.priority }
                : {}),
            },
          );
          return await Promise.race([invocation, timeout, cancellation]);
        } catch (error) {
          if (disposed)
            throw new BridgeError(
              "BRIDGE_DISPOSED",
              "The bridge client was disposed during the native call.",
              { method: methodName },
            );
          const failure = controller?.signal.aborted
            ? new BridgeError(
                "BRIDGE_TIMEOUT",
                `Bridge method ${methodName} timed out.`,
                { method: methodName, timeoutMs },
              )
            : error;
          const retryable =
            attempt < maxAttempts &&
            (failure instanceof BridgeError
              ? failure.code === "BRIDGE_TIMEOUT"
              : true);
          if (!retryable) throw failure;
          if (retryDelayMs > 0)
            await Promise.race([
              new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs)),
              cancellation,
            ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          if (controller !== undefined) activeCalls.delete(controller);
        }
      }
      throw new BridgeError(
        "BRIDGE_INVALID_RESPONSE",
        "The bridge call ended without a result.",
        { method: methodName },
      );
    },
    callWithTimeout(method, args, timeoutMs, callOptions) {
      return this.call(method, args, { ...callOptions, timeoutMs });
    },
    subscribe(event, listener) {
      ensureActive();
      if (!events.includes(event))
        throw new BridgeError(
          "BRIDGE_EVENT_DENIED",
          "The bridge event is not allow-listed.",
          {
            event,
          },
        );
      if (!options.transport.subscribe)
        throw new BridgeError(
          "BRIDGE_EVENT_DENIED",
          "This bridge transport does not support events.",
          {
            event,
          },
        );
      return options.transport.subscribe(event, listener);
    },
    methods: () => methods.map((method) => ({ ...method })),
    dispose() {
      disposed = true;
      for (const [controller, cancel] of activeCalls) {
        controller.abort();
        cancel(
          new BridgeError(
            "BRIDGE_DISPOSED",
            "The bridge client was disposed during the native call.",
          ),
        );
      }
    },
  };
}
