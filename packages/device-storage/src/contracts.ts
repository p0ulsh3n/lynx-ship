export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface DeviceStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
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
