import { BridgeError } from "./errors.js";
import type {
  BridgeCallOptions,
  BridgeMethod,
  BridgeValue,
} from "./contracts.js";

const METHOD_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export function validateMethod(method: BridgeMethod): void {
  if (!METHOD_NAME.test(method.name))
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Invalid bridge method name.",
      {
        method: method.name,
      },
    );
  for (const value of [method.timeoutMs, method.maxPayloadBytes])
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "Bridge limits must be positive safe integers.",
        {
          method: method.name,
        },
      );
  if (
    method.version !== undefined &&
    !/^\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(method.version)
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge method versions must use a semver-like value.",
      { method: method.name },
    );
  if (
    method.thread !== undefined &&
    !["main", "background"].includes(method.thread)
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge method threads must be main or background.",
      { method: method.name },
    );
  for (const value of [method.capability, ...(method.permissions ?? [])])
    if (value !== undefined && !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(value))
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "Bridge capability and permission names must be safe identifiers.",
        { method: method.name, value },
      );
}

export function validateIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge idempotency keys must be safe identifiers.",
    );
}

export function validateBridgeCallOptions(
  options: BridgeCallOptions | undefined,
): void {
  if (!options) return;
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs <= 0 ||
      options.timeoutMs > 120_000)
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge timeoutMs must be an integer between 1 and 120000.",
    );
  if (
    options.priority !== undefined &&
    !["high", "normal", "low"].includes(options.priority)
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge priorities must be high, normal or low.",
    );
  const maxAttempts = options.retry?.maxAttempts;
  const delayMs = options.retry?.delayMs;
  if (
    maxAttempts !== undefined &&
    (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge retry maxAttempts must be an integer between 1 and 5.",
    );
  if (
    delayMs !== undefined &&
    (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 30_000)
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge retry delayMs must be an integer between 0 and 30000.",
    );
  if ((maxAttempts ?? 1) > 1 && options.idempotencyKey === undefined)
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge retries require an idempotency key to prevent duplicate effects.",
    );
}

export function validateRequestId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge request IDs must be safe identifiers.",
    );
}

export function validateEvent(event: string): void {
  if (!METHOD_NAME.test(event))
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Invalid bridge event name.",
      { event },
    );
}

export function serializedBytes(value: BridgeValue): number {
  validateBridgeValue(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge arguments must be JSON-serializable.",
      { cause: error instanceof Error ? error.message : "unknown" },
    );
  }
  let bytes = 0;
  for (const character of serialized) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function validateBridgeValue(
  value: BridgeValue,
  path = "$",
  ancestors = new WeakSet<object>(),
): void {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  )
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge values must contain only JSON-compatible values.",
      { path },
    );
  if (typeof value === "number" && !Number.isFinite(value))
    throw new BridgeError(
      "BRIDGE_INVALID_CONTRACT",
      "Bridge values must contain only finite numbers.",
      { path },
    );
  if (Array.isArray(value)) {
    if (ancestors.has(value))
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "Bridge values must not contain cyclic references.",
        { path },
      );
    ancestors.add(value);
    value.forEach((item, index) =>
      validateBridgeValue(item, `${path}[${index}]`, ancestors),
    );
    ancestors.delete(value);
    return;
  }
  if (value !== null && typeof value === "object") {
    if (ancestors.has(value))
      throw new BridgeError(
        "BRIDGE_INVALID_CONTRACT",
        "Bridge values must not contain cyclic references.",
        { path },
      );
    ancestors.add(value);
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined)
        throw new BridgeError(
          "BRIDGE_INVALID_CONTRACT",
          "Bridge objects must not contain undefined values.",
          { path: `${path}.${key}` },
        );
      validateBridgeValue(item, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
  }
}
