export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface DeviceStorageOptions {
  /** Optional logical namespace, equivalent to a business/storage scope. */
  readonly namespace?: string;
  /** Expire the value after this many milliseconds. */
  readonly validDurationMs?: number;
}

export interface DeviceStorage {
  get<T>(
    key: string,
    options?: Pick<DeviceStorageOptions, "namespace">,
  ): Promise<T | null>;
  set<T>(key: string, value: T, options?: DeviceStorageOptions): Promise<void>;
  remove(
    key: string,
    options?: Pick<DeviceStorageOptions, "namespace">,
  ): Promise<void>;
  clear(): Promise<void>;
}

export class StorageSerializationError extends Error {
  public readonly code = "STORAGE_SERIALIZATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "StorageSerializationError";
  }
}

export class StorageKeyError extends Error {
  public readonly code = "STORAGE_KEY_INVALID";

  public constructor(message: string) {
    super(message);
    this.name = "StorageKeyError";
  }
}
