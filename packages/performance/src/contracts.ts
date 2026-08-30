export type PerformanceEntryType =
  | "init"
  | "metric"
  | "pipeline"
  | "resource"
  | "mark"
  | "measure";

export type PerformanceAttribute = string | number | boolean;

export interface PerformanceEntry {
  readonly entryType: PerformanceEntryType;
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly attributes?: Readonly<Record<string, PerformanceAttribute>>;
}

export interface PerformanceSource {
  start(emit: (entry: PerformanceEntry) => void): void | (() => void);
}

export interface PerformanceSink {
  write(entries: readonly PerformanceEntry[]): void | Promise<void>;
}

export interface PerformanceCollectorOptions {
  readonly source?: PerformanceSource;
  readonly sink?: PerformanceSink;
  readonly maxEntries?: number;
  readonly now?: () => number;
  readonly onEntry?: (entry: PerformanceEntry) => void;
  readonly onOverflow?: (dropped: number) => void;
}

export type PerformanceCollectorState = "idle" | "running" | "stopped";

export interface PerformanceCollector {
  readonly state: PerformanceCollectorState;
  start(): void;
  stop(): void;
  record(entry: PerformanceEntry): void;
  mark(
    name: string,
    attributes?: Readonly<Record<string, PerformanceAttribute>>,
  ): PerformanceEntry;
  measure(name: string, startMark: string, endMark?: string): PerformanceEntry;
  snapshot(): readonly PerformanceEntry[];
  flush(): Promise<readonly PerformanceEntry[]>;
  clear(): void;
}
