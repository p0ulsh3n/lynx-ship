import { PerformanceError } from "./errors.js";

export type BenchmarkPhase = "cold" | "warm";

export interface BenchmarkSample {
  readonly phase: BenchmarkPhase;
  readonly iteration: number;
  readonly firstScreenMs: number;
  readonly interactionMs?: number;
  readonly bundleBytes?: number;
}

export interface BenchmarkStats {
  readonly count: number;
  readonly min: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface PerformanceBenchmarkResult {
  readonly iterations: number;
  readonly warmupIterations: number;
  readonly samples: readonly BenchmarkSample[];
  readonly firstScreen: Readonly<Record<BenchmarkPhase, BenchmarkStats>>;
  readonly interaction: Readonly<
    Partial<Record<BenchmarkPhase, BenchmarkStats>>
  >;
}

export interface PerformanceBenchmarkOptions {
  readonly iterations?: number;
  readonly warmupIterations?: number;
  readonly signal?: AbortSignal;
  readonly run: (
    phase: BenchmarkPhase,
    iteration: number,
  ) => Promise<Omit<BenchmarkSample, "phase" | "iteration">>;
}

export interface BenchmarkComparison {
  readonly metric: "firstScreenMs" | "interactionMs";
  readonly left: BenchmarkStats;
  readonly right: BenchmarkStats;
  readonly p50Ratio: number;
  readonly p95Ratio: number;
  readonly winner: "left" | "right" | "tie";
}

const DEFAULT_ITERATIONS = 5;
const MAX_ITERATIONS = 100;
const MAX_DURATION_MS = 10 * 60 * 1000;

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new PerformanceError("PERFORMANCE_BENCHMARK_INVALID", message, details);
}

function validateDuration(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_DURATION_MS)
    invalid(`${name} must be between 0 and ${MAX_DURATION_MS} milliseconds.`, {
      name,
      value,
    });
}

function validateSample(
  sample: Omit<BenchmarkSample, "phase" | "iteration">,
): void {
  validateDuration(sample.firstScreenMs, "firstScreenMs");
  if (sample.interactionMs !== undefined)
    validateDuration(sample.interactionMs, "interactionMs");
  if (
    sample.bundleBytes !== undefined &&
    (!Number.isSafeInteger(sample.bundleBytes) || sample.bundleBytes < 0)
  )
    invalid("bundleBytes must be a non-negative safe integer.", {
      bundleBytes: sample.bundleBytes,
    });
}

function stats(values: readonly number[]): BenchmarkStats {
  if (values.length === 0)
    invalid("Cannot calculate statistics for no samples.");
  const sorted = [...values].sort((left, right) => left - right);
  const valueAt = (index: number): number => {
    const value = sorted[index];
    if (value === undefined) invalid("Benchmark statistic index is invalid.");
    return value;
  };
  const percentile = (rank: number): number =>
    valueAt(Math.min(sorted.length - 1, Math.ceil(rank * sorted.length) - 1));
  return {
    count: sorted.length,
    min: valueAt(0),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: valueAt(sorted.length - 1),
  };
}

function phaseValues(
  samples: readonly BenchmarkSample[],
  phase: BenchmarkPhase,
  field: "firstScreenMs" | "interactionMs",
): number[] {
  return samples
    .filter((sample) => sample.phase === phase)
    .map((sample) => sample[field])
    .filter((value): value is number => value !== undefined);
}

/** Runs a bounded cold/warm benchmark supplied by a real host adapter. */
export async function runPerformanceBenchmark(
  options: PerformanceBenchmarkOptions,
): Promise<PerformanceBenchmarkResult> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const warmupIterations = options.warmupIterations ?? 0;
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_ITERATIONS ||
    !Number.isSafeInteger(warmupIterations) ||
    warmupIterations < 0 ||
    warmupIterations > MAX_ITERATIONS
  )
    invalid("Benchmark iteration counts are outside the supported bounds.");

  const samples: BenchmarkSample[] = [];
  for (const phase of ["cold", "warm"] as const) {
    for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
      if (options.signal?.aborted)
        throw new PerformanceError(
          "PERFORMANCE_BENCHMARK_ABORTED",
          "Benchmark aborted.",
        );
      const sample = await options.run(phase, -iteration - 1);
      validateSample(sample);
    }
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      if (options.signal?.aborted)
        throw new PerformanceError(
          "PERFORMANCE_BENCHMARK_ABORTED",
          "Benchmark aborted.",
        );
      const sample = await options.run(phase, iteration);
      validateSample(sample);
      samples.push({ phase, iteration, ...sample });
    }
  }

  const firstScreen = {
    cold: stats(phaseValues(samples, "cold", "firstScreenMs")),
    warm: stats(phaseValues(samples, "warm", "firstScreenMs")),
  };
  const interaction: Partial<Record<BenchmarkPhase, BenchmarkStats>> = {};
  for (const phase of ["cold", "warm"] as const) {
    const values = phaseValues(samples, phase, "interactionMs");
    if (values.length > 0) interaction[phase] = stats(values);
  }
  return { iterations, warmupIterations, samples, firstScreen, interaction };
}

/** Compares p50/p95 values; differences below 5% are treated as ties. */
export function compareBenchmarkStats(
  metric: BenchmarkComparison["metric"],
  left: BenchmarkStats,
  right: BenchmarkStats,
  tieThreshold = 0.05,
): BenchmarkComparison {
  if (!Number.isFinite(tieThreshold) || tieThreshold < 0 || tieThreshold >= 1)
    invalid("tieThreshold must be at least 0 and less than 1.");
  const p50Ratio = left.p50 / right.p50;
  const p95Ratio = left.p95 / right.p95;
  const margin = Math.max(Math.abs(1 - p50Ratio), Math.abs(1 - p95Ratio));
  return {
    metric,
    left,
    right,
    p50Ratio,
    p95Ratio,
    winner:
      margin <= tieThreshold
        ? "tie"
        : p50Ratio < 1 && p95Ratio < 1
          ? "left"
          : "right",
  };
}
