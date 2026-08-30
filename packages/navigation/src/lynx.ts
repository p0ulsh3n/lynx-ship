import type { Platform } from "@lynxship/contracts";
import type { NavigationAdapter, NavigationTarget } from "./contracts.js";

export interface LynxNavigationModule {
  create?(url: string, callback: (result: unknown) => void): void;
  open(url: string, callback: (result: unknown) => void): void;
  replace(url: string, callback: (result: unknown) => void): void;
  setBackPressHandling?(
    enabled: boolean,
    callback: (result: unknown) => void,
  ): void;
  openInSystemBrowser?(url: string, callback: (result: unknown) => void): void;
  back(callback: (result: unknown) => void): void;
  close?(callback: (result: unknown) => void): void;
  updateChrome?(json: string, callback: (result: unknown) => void): void;
}

export function getLynxNavigationModule(): LynxNavigationModule {
  const nativeModules = (
    globalThis as typeof globalThis & {
      NativeModules?: Record<string, unknown>;
    }
  ).NativeModules;
  const module = nativeModules?.LynxShipNavigation;
  if (!module || typeof module !== "object")
    throw new Error("LynxShipNavigation native module is not linked.");
  const candidate = module as Partial<LynxNavigationModule>;
  if (
    typeof candidate.open !== "function" ||
    typeof candidate.replace !== "function" ||
    typeof candidate.back !== "function"
  )
    throw new Error("LynxShipNavigation native module is incomplete.");
  return candidate as LynxNavigationModule;
}

export function createLynxNavigationAdapter(
  platform: Extract<Platform, "android" | "ios">,
  module: LynxNavigationModule = getLynxNavigationModule(),
): NavigationAdapter {
  return {
    platform,
    create: module.create
      ? (target) => invoke(module.create!, module, target)
      : undefined,
    open: (target) => invoke(module.open, module, target),
    replace: (target) => invoke(module.replace, module, target),
    openInSystemBrowser: module.openInSystemBrowser
      ? (target) => invoke(module.openInSystemBrowser!, module, target)
      : undefined,
    back: () =>
      new Promise<boolean>((resolve, reject) => {
        try {
          module.back((result) => resolve(readBackResult(result)));
        } catch (error) {
          reject(error);
        }
      }),
    setBackPressHandling: module.setBackPressHandling
      ? (enabled) =>
          new Promise<void>((resolve, reject) => {
            try {
              module.setBackPressHandling!(enabled, (result) => {
                if (readSuccess(result)) resolve();
                else
                  reject(
                    new Error(
                      "The native navigation host rejected back-press handling.",
                    ),
                  );
              });
            } catch (error) {
              reject(error);
            }
          })
      : undefined,
    close: module.close
      ? () =>
          new Promise<boolean>((resolve, reject) => {
            try {
              module.close?.((result) => resolve(readBackResult(result)));
            } catch (error) {
              reject(error);
            }
          })
      : undefined,
    updateChrome: module.updateChrome
      ? (chrome) =>
          invokeJson(module.updateChrome!, module, JSON.stringify(chrome))
      : undefined,
  };
}

function invoke(
  method: LynxNavigationModule["open"],
  module: LynxNavigationModule,
  target: NavigationTarget,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      method.call(module, target.url, (result) => {
        if (readSuccess(result)) resolve();
        else
          reject(
            new Error(
              "The native LynxShip navigation host rejected the target.",
            ),
          );
      });
    } catch (error) {
      reject(error);
    }
  });
}

function invokeJson(
  method: NonNullable<LynxNavigationModule["updateChrome"]>,
  module: LynxNavigationModule,
  json: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      method.call(module, json, (result) => {
        if (readSuccess(result)) resolve();
        else
          reject(new Error("The native navigation host rejected the chrome."));
      });
    } catch (error) {
      reject(error);
    }
  });
}

function readSuccess(result: unknown): boolean {
  if (result === true) return true;
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  return value.success === true || value.code === 1;
}

function readBackResult(result: unknown): boolean {
  if (typeof result === "boolean") return result;
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  if (typeof value.changed === "boolean") return value.changed;
  return readSuccess(result);
}
