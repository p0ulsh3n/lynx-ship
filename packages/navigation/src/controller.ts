import type { Platform } from "@lynxship/contracts";
import {
  type NavigationAdapter,
  type NavigationController,
  type NavigationEvent,
  type NavigationInterceptor,
  type NavigationOperation,
  type NavigationPolicy,
  type NavigationTarget,
} from "./contracts.js";
import { NavigationError } from "./errors.js";
import { normalizeNavigationChrome } from "./chrome.js";
import { normalizeNavigationTarget } from "./policy.js";
import { buildLynxScheme } from "./scheme.js";

export interface NavigationOptions {
  readonly platform: Platform;
  readonly adapter: NavigationAdapter;
  readonly policy?: NavigationPolicy;
  readonly interceptors?: readonly NavigationInterceptor[];
  readonly createId?: () => string;
}

export function createNavigationController(
  options: NavigationOptions,
): NavigationController {
  if (options.adapter.platform !== options.platform)
    throw new NavigationError(
      "NAVIGATION_PLATFORM_MISMATCH",
      "The navigation adapter platform must match the controller platform.",
      { controller: options.platform, adapter: options.adapter.platform },
    );
  const listeners = new Set<(event: NavigationEvent) => void>();
  let current: NavigationTarget | undefined;
  let stack: NavigationTarget[] = [];
  let disposed = false;
  let sequence = 0;
  const createId = options.createId ?? (() => `navigation_${++sequence}`);
  const interceptors = options.interceptors ?? [];
  if (interceptors.length > 32)
    throw new NavigationError(
      "NAVIGATION_INVALID_TARGET",
      "Navigation supports at most 32 interceptors.",
    );
  const emit = (event: NavigationEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };
  const ensureActive = (): void => {
    if (disposed)
      throw new NavigationError(
        "NAVIGATION_DISPOSED",
        "The navigation controller has been disposed.",
      );
  };
  const callWithoutStack = async (
    target: NavigationTarget,
    operation: "create" | "openInSystemBrowser",
  ): Promise<void> => {
    ensureActive();
    const normalized = await intercept(
      target,
      operation === "create" ? "open" : "system-browser",
    );
    const action = options.adapter[operation];
    if (!action)
      throw new NavigationError(
        "NAVIGATION_CAPABILITY_MISSING",
        `The native navigation adapter does not implement ${operation}.`,
        { operation },
      );
    await action(normalized);
  };
  const navigate = async (
    target: NavigationTarget,
    replace: boolean,
  ): Promise<void> => {
    ensureActive();
    const operation = replace ? "replace" : "open";
    const normalized = await intercept(target, operation);
    const id = createId();
    emit({ type: "will-open", id, target: normalized });
    try {
      if (replace) await options.adapter.replace(normalized);
      else await options.adapter.open(normalized);
      stack =
        replace && stack.length > 0
          ? [...stack.slice(0, -1), normalized]
          : [...stack, normalized];
      current = stack.at(-1);
      emit({ type: "did-open", id, target: normalized });
    } catch (error) {
      emit({ type: "failed", id, error });
      throw error;
    }
  };
  return {
    platform: options.platform,
    get current() {
      return current;
    },
    get stack() {
      return [...stack];
    },
    create: (target) => callWithoutStack(target, "create"),
    open: (target) => navigate(target, false),
    navigate(request) {
      const target = {
        url: buildLynxScheme(request),
        ...(request.presentation ? { presentation: request.presentation } : {}),
      };
      return navigate(target, request.replace === true);
    },
    replace: (target) => navigate(target, true),
    openInSystemBrowser: (target) =>
      callWithoutStack(target, "openInSystemBrowser"),
    async updateChrome(chrome) {
      ensureActive();
      const updateChrome = options.adapter.updateChrome;
      if (!updateChrome)
        throw new NavigationError(
          "NAVIGATION_CAPABILITY_MISSING",
          "The native navigation adapter does not implement updateChrome.",
          { operation: "updateChrome" },
        );
      await updateChrome(normalizeNavigationChrome(chrome));
    },
    async back() {
      ensureActive();
      const id = createId();
      const changed = await options.adapter.back();
      if (changed) {
        stack = stack.slice(0, -1);
        current = stack.at(-1);
      }
      emit({ type: "did-back", id, changed });
      return changed;
    },
    async setBackPressHandling(enabled) {
      ensureActive();
      if (typeof enabled !== "boolean")
        throw new NavigationError(
          "NAVIGATION_INVALID_TARGET",
          "Back press handling must be boolean.",
        );
      const setBackPressHandling = options.adapter.setBackPressHandling;
      if (!setBackPressHandling)
        throw new NavigationError(
          "NAVIGATION_CAPABILITY_MISSING",
          "The native navigation adapter does not implement setBackPressHandling.",
          { operation: "setBackPressHandling" },
        );
      await setBackPressHandling(enabled);
    },
    async close() {
      ensureActive();
      const id = createId();
      const changed = options.adapter.close
        ? await options.adapter.close()
        : await options.adapter.back();
      if (changed) {
        stack = stack.slice(0, -1);
        current = stack.at(-1);
      }
      emit({ type: "did-close", id, changed });
      return changed;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stack = [];
      current = undefined;
      listeners.clear();
    },
  };

  async function intercept(
    initial: NavigationTarget,
    operation: NavigationOperation,
  ): Promise<NavigationTarget> {
    let target = normalizeNavigationTarget(initial, options.policy);
    for (let round = 0; round < 8; round++) {
      let redirected = false;
      for (const interceptor of interceptors) {
        const result = await interceptor(Object.freeze({ operation, target }));
        if (!result) continue;
        if ("cancel" in result && result.cancel) {
          throw new NavigationError(
            "NAVIGATION_INTERCEPTED",
            result.reason ?? "Navigation was cancelled by an interceptor.",
            { operation, url: target.url },
          );
        }
        if ("target" in result) {
          target = normalizeNavigationTarget(result.target, options.policy);
          redirected = true;
        }
      }
      if (!redirected) return target;
    }
    throw new NavigationError(
      "NAVIGATION_INTERCEPTED",
      "Navigation exceeded the redirect limit.",
      { operation },
    );
  }
}
