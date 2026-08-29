import type {
  EventRecord,
  EventSink,
  Observability,
  ObservabilityValue,
} from "./contracts.js";
import { redactAttributes } from "./redaction.js";

export function createObservability(
  sink: EventSink,
  options: { maxBuffer?: number; clock?: () => number } = {},
): Observability {
  const requestedMaxBuffer = options.maxBuffer ?? 100;
  if (!Number.isSafeInteger(requestedMaxBuffer) || requestedMaxBuffer < 1)
    throw new Error("Observability maxBuffer must be a positive safe integer.");
  const maxBuffer = requestedMaxBuffer;
  const clock = options.clock ?? Date.now;
  const buffer: EventRecord[] = [];
  return {
    track: (
      name: string,
      attributes: Readonly<Record<string, ObservabilityValue>> = {},
    ) => {
      if (!name.trim()) return;
      const timestamp = clock();
      if (!Number.isFinite(timestamp))
        throw new Error("Observability clock must return a finite timestamp.");
      buffer.push({
        name,
        timestamp,
        attributes: redactAttributes(attributes),
      });
      if (buffer.length > maxBuffer)
        buffer.splice(0, buffer.length - maxBuffer);
    },
    flush: async () => {
      if (buffer.length) {
        const batch = buffer.splice(0, buffer.length);
        await sink.write(batch);
      }
    },
    size: () => buffer.length,
  };
}
