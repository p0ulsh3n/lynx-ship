import type { LocaleStorage } from "./contracts.js";

const DEFAULT_LOCALE_KEY = "lynxship.locale";

interface LynxDeviceStorageModule {
  getItem(key: string, callback: (value: string | null) => void): void;
  setItem(
    key: string,
    value: string,
    callback?: (success: boolean) => void,
  ): void;
  removeItem(key: string, callback?: (success: boolean) => void): void;
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNativeStorage(): LynxDeviceStorageModule | undefined {
  const nativeModules = (
    globalThis as typeof globalThis & {
      NativeModules?: Record<string, unknown>;
    }
  ).NativeModules;
  const module = nativeModules?.LynxShipDeviceStorage;
  if (!isRecord(module)) return undefined;
  if (
    typeof module.getItem !== "function" ||
    typeof module.setItem !== "function"
  )
    return undefined;
  return module as unknown as LynxDeviceStorageModule;
}

function getWebStorage(): WebStorageLike | undefined {
  try {
    const candidate = (
      globalThis as typeof globalThis & {
        localStorage?: WebStorageLike;
      }
    ).localStorage;
    if (!candidate) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

/**
 * Resolve LynxShip's persistent storage bridge without requiring a platform
 * SDK in the portable i18n package. The lookup happens only when this factory
 * is called; importing the package never touches globals or storage.
 */
export function createLynxLocaleStorage(): LocaleStorage | undefined {
  const native = getNativeStorage();
  if (native) {
    return {
      get: (key) => new Promise((resolve) => native.getItem(key, resolve)),
      set: (key, value) =>
        new Promise((resolve) => native.setItem(key, value, () => resolve())),
      remove: (key) =>
        native.removeItem
          ? new Promise((resolve) => native.removeItem?.(key, () => resolve()))
          : Promise.resolve(),
    };
  }

  const web = getWebStorage();
  if (!web) return undefined;
  return {
    get: async (key) => web.getItem(key),
    set: async (key, value) => web.setItem(key, value),
    remove: async (key) => web.removeItem(key),
  };
}

export { DEFAULT_LOCALE_KEY };
