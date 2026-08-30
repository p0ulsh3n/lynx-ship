import type {
  PerformanceAttribute,
  PerformanceCollector,
  PerformanceCollectorOptions,
  PerformanceEntry,
} from "./contracts.js";
import { PerformanceError } from "./errors.js";
import { validateEntry, validateLimit } from "./validation.js";

function defaultNow(): number {
  const performance = globalThis.performance;
  return performance && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function clone(entry: PerformanceEntry): PerformanceEntry {
  return {
    ...entry,
    ...(entry.attributes ? { attributes: { ...entry.attributes } } : {}),
  };
}

export function createPerformanceCollector(
  options: PerformanceCollectorOptions = {},
): PerformanceCollector {
  const maxEntries = validateLimit(options.maxEntries);
  const now = options.now ?? defaultNow;
  const entries: PerformanceEntry[] = [];
  const marks = new Map<string, PerformanceEntry>();
  let state: "idle" | "running" | "stopped" = "idle";
  let unsubscribe: (() => void) | undefined;
  const ensureRunning = (): void => {
    if (state !== "running")
      throw new PerformanceError(
        "PERFORMANCE_INVALID_STATE",
        "Performance entries can only be recorded while the collector is running.",
      );
  };
  const record = (entry: PerformanceEntry): PerformanceEntry => {
    ensureRunning();
    validateEntry(entry);
    const normalized = clone(entry);
    entries.push(normalized);
    let dropped = 0;
    while (entries.length > maxEntries) {
      const removed = entries.shift();
      if (removed?.entryType === "mark" && marks.get(removed.name) === removed)
        marks.delete(removed.name);
      dropped += 1;
    }
    if (dropped > 0) options.onOverflow?.(dropped);
    options.onEntry?.(clone(normalized));
    return normalized;
  };
  return {
    get state() {
      return state;
    },
    start() {
      if (state !== "idle")
        throw new PerformanceError(
          "PERFORMANCE_INVALID_STATE",
          "A performance collector can only start once.",
        );
      state = "running";
      try {
        if (options.source)
          unsubscribe = options.source.start(record) || undefined;
      } catch (error) {
        state = "stopped";
        throw error;
      }
    },
    stop() {
      if (state !== "running") return;
      unsubscribe?.();
      unsubscribe = undefined;
      state = "stopped";
    },
    record,
    mark(name, attributes?: Readonly<Record<string, PerformanceAttribute>>) {
      const entry: PerformanceEntry = {
        entryType: "mark",
        name,
        startTime: now(),
        duration: 0,
        ...(attributes ? { attributes } : {}),
      };
      const stored = record(entry);
      marks.set(name, stored);
      return clone(stored);
    },
    measure(name, startMark, endMark) {
      const start = marks.get(startMark);
      const end = endMark ? marks.get(endMark) : undefined;
      if (!start || (endMark && !end))
        throw new PerformanceError(
          "PERFORMANCE_MARK_NOT_FOUND",
          "The requested performance mark does not exist.",
          {
            startMark,
            endMark,
          },
        );
      const startTime = start.startTime;
      const endTime = end?.startTime ?? now();
      if (endTime < startTime)
        throw new PerformanceError(
          "PERFORMANCE_INVALID_ENTRY",
          "A performance measure cannot end before it starts.",
        );
      const entry: PerformanceEntry = {
        entryType: "measure",
        name,
        startTime,
        duration: endTime - startTime,
      };
      record(entry);
      return clone(entry);
    },
    snapshot() {
      return entries.map(clone);
    },
    async flush() {
      const pending = entries.map(clone);
      if (pending.length === 0) return pending;
      if (options.sink) await options.sink.write(pending);
      entries.splice(0, pending.length);
      return pending;
    },
    clear() {
      entries.length = 0;
      marks.clear();
    },
  };
}
