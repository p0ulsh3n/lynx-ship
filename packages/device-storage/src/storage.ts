import {
  StorageKeyError,
  StorageSerializationError,
  type DeviceStorage,
  type DeviceStorageOptions,
  type StorageAdapter,
} from "./contracts.js";

const MAX_KEY_LENGTH = 256;
const MAX_NAMESPACE_LENGTH = 64;
const NAMESPACE_SEPARATOR = "::";
const ENVELOPE_VERSION = 1;

interface ExpiringValue {
  readonly __lynxshipStorageVersion: typeof ENVELOPE_VERSION;
  readonly value: unknown;
  readonly expiresAt: number;
}

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

function storageKey(key: string, namespace?: string): string {
  validateKey(key);
  if (namespace === undefined) return key;
  if (
    typeof namespace !== "string" ||
    namespace.length === 0 ||
    namespace.length > MAX_NAMESPACE_LENGTH ||
    /[^A-Za-z0-9_.-]/.test(namespace)
  )
    throw new StorageKeyError(
      `Storage namespaces must be 1-${MAX_NAMESPACE_LENGTH} safe characters.`,
    );
  const result = `${namespace}${NAMESPACE_SEPARATOR}${key}`;
  if (result.length > MAX_KEY_LENGTH)
    throw new StorageKeyError("The namespaced storage key is too long.");
  return result;
}

function options(
  value: DeviceStorageOptions | undefined,
): DeviceStorageOptions {
  if (value === undefined) return {};
  if (value.validDurationMs !== undefined) {
    if (
      !Number.isSafeInteger(value.validDurationMs) ||
      value.validDurationMs < 1 ||
      value.validDurationMs > 365 * 24 * 60 * 60 * 1000
    )
      throw new StorageKeyError(
        "validDurationMs must be an integer between 1 ms and 365 days.",
      );
  }
  storageKey("probe", value.namespace);
  return value;
}

export function createDeviceStorage(adapter: StorageAdapter): DeviceStorage {
  return {
    get: async <T>(
      key: string,
      input?: Pick<DeviceStorageOptions, "namespace">,
    ) => {
      const keyValue = storageKey(key, input?.namespace);
      const raw = await adapter.get(keyValue);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<ExpiringValue>;
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          parsed.__lynxshipStorageVersion === ENVELOPE_VERSION &&
          typeof parsed.expiresAt === "number"
        ) {
          if (parsed.expiresAt <= Date.now()) {
            await adapter.remove(keyValue);
            return null;
          }
          return parsed.value as T;
        }
        return parsed as T;
      } catch {
        throw new StorageSerializationError(
          `Stored value for '${key}' is not valid JSON.`,
        );
      }
    },
    set: async <T>(key: string, value: T, input?: DeviceStorageOptions) => {
      const settings = options(input);
      const keyValue = storageKey(key, settings.namespace);
      try {
        const stored: unknown =
          settings.validDurationMs === undefined
            ? value
            : ({
                __lynxshipStorageVersion: ENVELOPE_VERSION,
                value,
                expiresAt: Date.now() + settings.validDurationMs,
              } satisfies ExpiringValue);
        const serialized = JSON.stringify(stored);
        if (serialized === undefined)
          throw new Error("JSON.stringify returned undefined.");
        await adapter.set(keyValue, serialized);
      } catch (error) {
        throw new StorageSerializationError(
          `Value for '${keyValue}' cannot be serialized: ${String(error)}`,
        );
      }
    },
    remove: (key: string, input?: Pick<DeviceStorageOptions, "namespace">) => {
      return adapter.remove(storageKey(key, input?.namespace));
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
