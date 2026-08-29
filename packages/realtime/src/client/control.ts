import {
  REALTIME_PROTOCOL_VERSION,
  defaultRandom,
  newId,
  utf8ByteLength,
  type JsonValue,
  type RealtimeEnvelope,
} from "./core.js";

export function serializeControlFrame(input: {
  type: string;
  payload: JsonValue;
  now: () => number;
  random?: () => number;
  sequence: number;
  maxBytes: number;
}): { serialized: string; nextSequence: number } | null {
  const envelope: RealtimeEnvelope = {
    v: REALTIME_PROTOCOL_VERSION,
    type: input.type,
    id: `${newId(input.now, input.random ?? defaultRandom)}-${input.sequence}`,
    ts: Math.floor(input.now()),
    payload: input.payload,
  };
  const serialized = JSON.stringify(envelope);
  if (utf8ByteLength(serialized) > input.maxBytes) return null;
  return { serialized, nextSequence: input.sequence + 1 };
}
