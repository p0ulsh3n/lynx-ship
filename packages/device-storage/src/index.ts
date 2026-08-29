export * from "./contracts.js";

export * from "./storage.js";

import { type DeviceStorage, type StorageAdapter } from "./contracts.js";
import { createDeviceStorage } from "./storage.js";

export interface LynxDeviceStorageModule {
  getItem(key: string, callback: (value: string | null) => void): void;
  setItem(
    key: string,
    value: string,
    callback?: (success: boolean) => void,
  ): void;
  removeItem(key: string, callback?: (success: boolean) => void): void;
  clear(callback?: (success: boolean) => void): void;
}

export function getLynxDeviceStorageModule(): LynxDeviceStorageModule {
  const nativeModules = (
    globalThis as typeof globalThis & {
      NativeModules?: Record<string, unknown>;
    }
  ).NativeModules;
  const module = nativeModules?.LynxShipDeviceStorage;
  if (!module || typeof module !== "object")
    throw new Error("LynxShipDeviceStorage native module is not linked.");
  return module as LynxDeviceStorageModule;
}

export function createLynxDeviceStorage(
  module = getLynxDeviceStorageModule(),
): DeviceStorage {
  const adapter: StorageAdapter = {
    get: (key) => new Promise((resolve) => module.getItem(key, resolve)),
    set: (key, value) =>
      new Promise((resolve) => module.setItem(key, value, () => resolve())),
    remove: (key) =>
      new Promise((resolve) => module.removeItem(key, () => resolve())),
    clear: () => new Promise((resolve) => module.clear(() => resolve())),
  };
  return createDeviceStorage(adapter);
}
