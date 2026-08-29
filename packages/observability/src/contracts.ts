export type ObservabilityValue =
  | string
  | number
  | boolean
  | null
  | readonly ObservabilityValue[]
  | { readonly [key: string]: ObservabilityValue };

export interface EventRecord {
  readonly name: string;
  readonly timestamp: number;
  readonly attributes: Readonly<Record<string, ObservabilityValue>>;
}

export interface EventSink {
  write(events: readonly EventRecord[]): Promise<void>;
}

export interface Observability {
  track(
    name: string,
    attributes?: Readonly<Record<string, ObservabilityValue>>,
  ): void;
  flush(): Promise<void>;
  size(): number;
}
