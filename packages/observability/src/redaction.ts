import type { ObservabilityValue } from "./contracts.js";

const SENSITIVE =
  /token|secret|password|authorization|cookie|private.?key|access.?key/i;

export function redactAttributes(
  attributes: Readonly<Record<string, ObservabilityValue>>,
): Readonly<Record<string, ObservabilityValue>> {
  const seen = new WeakSet<object>();
  const MAX_DEPTH = 16;
  const redact = (
    key: string,
    value: ObservabilityValue,
    depth: number,
  ): ObservabilityValue => {
    if (SENSITIVE.test(key)) return "[REDACTED]";
    if (depth > MAX_DEPTH) return "[REDACTED_TOO_DEEP]";
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[REDACTED_CYCLIC]";
      seen.add(value);
      const result = Array.isArray(value)
        ? value.map((item) => redact(key, item, depth + 1))
        : Object.fromEntries(
            Object.entries(value).map(([child, item]) => [
              child,
              redact(child, item, depth + 1),
            ]),
          );
      seen.delete(value);
      return result;
    }
    return value;
  };
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      redact(key, value, 0),
    ]),
  );
}
