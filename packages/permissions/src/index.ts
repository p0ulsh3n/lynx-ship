export * from "./contracts.js";

export * from "./client.js";

import {
  PermissionError,
  type PermissionClient,
  type PermissionResult,
  type PermissionState,
} from "./contracts.js";

export interface LynxPermissionsModule {
  checkPermission(name: string, callback: (state: string) => void): void;
  requestPermission(name: string, callback: (state: string) => void): void;
  openSettings(callback?: (success: boolean) => void): void;
}

export function getLynxPermissionsModule(): LynxPermissionsModule {
  const nativeModules = (
    globalThis as typeof globalThis & {
      NativeModules?: Record<string, unknown>;
    }
  ).NativeModules;
  const module = nativeModules?.LynxShipPermissions;
  if (!module || typeof module !== "object")
    throw new PermissionError(
      "LynxShipPermissions native module is not linked.",
    );
  return module as LynxPermissionsModule;
}

export function createLynxPermissionClient(
  module = getLynxPermissionsModule(),
): PermissionClient {
  const call = (
    method: "checkPermission" | "requestPermission",
    name: string,
  ) =>
    new Promise<PermissionResult>((resolve) =>
      module[method](name, (state) =>
        resolve({
          name,
          state: normalizeNativeState(state),
          canAskAgain: state === "denied",
        }),
      ),
    );
  return {
    check: (name) => call("checkPermission", name),
    request: (name) => call("requestPermission", name),
    requestMany: async (names) => {
      const results: PermissionResult[] = [];
      for (const name of [...new Set(names)])
        results.push(await call("requestPermission", name));
      return results;
    },
    openSettings: () =>
      new Promise((resolve, reject) => {
        try {
          module.openSettings((success = true) =>
            success
              ? resolve()
              : reject(
                  new PermissionError(
                    "The host could not open system settings.",
                  ),
                ),
          );
        } catch (error) {
          reject(error);
        }
      }),
  };
}

function normalizeNativeState(state: string): PermissionState {
  return state === "granted" || state === "blocked" || state === "unavailable"
    ? state
    : "denied";
}
