import {
  CONTROL_TYPES,
  REALTIME_PROTOCOL_VERSION,
  assertJsonValue,
  type RealtimeEnvelope,
} from "./core.js";

export type ProtocolFailure = (message: string, cause?: unknown) => void;

export function parseRealtimeEnvelope(
  value: unknown,
  onFailure: ProtocolFailure,
): RealtimeEnvelope | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    onFailure("Realtime frame must be an object");
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
    onFailure("Realtime frame has an invalid envelope");
    return null;
  }
  if (
    candidate.id.length === 0 ||
    candidate.id.length > 128 ||
    !/^[A-Za-z0-9_.:-]+$/.test(candidate.id)
  ) {
    onFailure("Realtime frame has an invalid id");
    return null;
  }
  if (candidate.type.startsWith("$") && !CONTROL_TYPES.has(candidate.type)) {
    onFailure("Realtime frame uses an unknown reserved type");
    return null;
  }
  try {
    assertJsonValue(candidate.payload);
  } catch (error) {
    onFailure("Realtime frame payload is invalid", error);
    return null;
  }
  return candidate as unknown as RealtimeEnvelope;
}
