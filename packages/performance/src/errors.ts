export class PerformanceError extends Error {
  public readonly code:
    | "PERFORMANCE_INVALID_ENTRY"
    | "PERFORMANCE_INVALID_LIMIT"
    | "PERFORMANCE_INVALID_STATE"
    | "PERFORMANCE_MARK_NOT_FOUND"
    | "PERFORMANCE_BENCHMARK_INVALID"
    | "PERFORMANCE_BENCHMARK_ABORTED";

  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: PerformanceError["code"],
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "PerformanceError";
    this.code = code;
    this.details = details;
  }
}
