import { PerformanceError } from "./errors.js";
import type { PerformanceEntry } from "./contracts.js";

const ENTRY_TYPES = new Set([
  "init",
  "metric",
  "pipeline",
  "resource",
  "mark",
  "measure",
]);

export function validateEntry(entry: PerformanceEntry): void {
  if (!ENTRY_TYPES.has(entry.entryType))
    throw new PerformanceError(
      "PERFORMANCE_INVALID_ENTRY",
      "Unknown performance entry type.",
    );
  if (!entry.name.trim() || entry.name.length > 256)
    throw new PerformanceError(
      "PERFORMANCE_INVALID_ENTRY",
      "Performance entry names must be non-empty and bounded.",
    );
  if (!Number.isFinite(entry.startTime) || entry.startTime < 0)
    throw new PerformanceError(
      "PERFORMANCE_INVALID_ENTRY",
      "Performance startTime must be a finite non-negative number.",
    );
  if (!Number.isFinite(entry.duration) || entry.duration < 0)
    throw new PerformanceError(
      "PERFORMANCE_INVALID_ENTRY",
      "Performance duration must be a finite non-negative number.",
    );
  for (const [key, value] of Object.entries(entry.attributes ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(key))
      throw new PerformanceError(
        "PERFORMANCE_INVALID_ENTRY",
        "Performance attribute names must be safe and bounded.",
        { key },
      );
    if (typeof value === "string" && value.length > 512)
      throw new PerformanceError(
        "PERFORMANCE_INVALID_ENTRY",
        "Performance attribute strings must be bounded.",
        { key },
      );
  }
}

export function validateLimit(value: number | undefined): number {
  const limit = value ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000)
    throw new PerformanceError(
      "PERFORMANCE_INVALID_LIMIT",
      "Performance maxEntries must be between 1 and 100000.",
    );
  return limit;
}
