import {
  StorageKeyError,
  StorageSerializationError,
  type DeviceStorage,
  type StorageAdapter,
} from "./contracts.js";

const MAX_KEY_LENGTH = 256;

function validateKey(key: string): string {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_KEY_LENGTH ||
    /[\u0000-\u001f]/.test(key)
  )
    throw new StorageKeyError(
      `Storage keys must be non-empty, at most ${MAX_KEY_LENGTH} characters and free of control characters.`,
    );
  return key;
}

export function createDeviceStorage(adapter: StorageAdapter): DeviceStorage {
  return {
    get: async <T>(key: string) => {
      validateKey(key);
      const raw = await adapter.get(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        throw new StorageSerializationError(
          `Stored value for '${key}' is not valid JSON.`,
        );
      }
    },
    set: async <T>(key: string, value: T) => {
      validateKey(key);
      try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined)
          throw new Error("JSON.stringify returned undefined.");
        await adapter.set(key, serialized);
      } catch (error) {
        throw new StorageSerializationError(
          `Value for '${key}' cannot be serialized: ${String(error)}`,
        );
      }
    },
    remove: (key) => {
      validateKey(key);
      return adapter.remove(key);
    },
    clear: () => adapter.clear(),
  };
}

export function createMemoryStorage(): StorageAdapter {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
    clear: async () => {
      values.clear();
    },
  };
}
