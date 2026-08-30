import { FrameworkError } from "../contracts/platform.js";
import { ExclusiveOperationQueue } from "../lifecycle/async.js";
import type {
  BundleReference,
  ContainerMountRequest,
  ContainerMountResult,
  ContainerPrepareRequest,
  ContainerSize,
  ContainerUpdateRequest,
  LynxShipContainer,
} from "./contracts.js";
import {
  validateBundleReference,
  validateContainerMountRequest,
} from "./validation.js";

export type ContainerLoadState =
  | "idle"
  | "loading"
  | "loaded"
  | "failed"
  | "released";

export interface ContainerViewport {
  readonly width: number;
  readonly height: number;
}

export type ContainerRuntimeEvent =
  | { readonly type: "prepare-start"; readonly bundle: BundleReference }
  | { readonly type: "prepared"; readonly bundle: BundleReference }
  | { readonly type: "load-start"; readonly bundle: BundleReference }
  | { readonly type: "first-screen"; readonly bundle: BundleReference }
  | { readonly type: "update"; readonly bundle: BundleReference }
  | { readonly type: "data-update"; readonly bundle: BundleReference }
  | { readonly type: "show" }
  | { readonly type: "hide" }
  | { readonly type: "viewport"; readonly viewport: ContainerViewport }
  | { readonly type: "intrinsic-size"; readonly size: ContainerSize }
  | { readonly type: "error"; readonly error: unknown }
  | { readonly type: "released" };

/**
 * Optional presentation hook for loading, error, retry and lifecycle UI.
 * Providers are deliberately event-driven so an application can render them
 * with ReactLynx, Expo, native views or a dashboard without coupling the
 * portable runtime to one UI toolkit.
 */
export interface ContainerUiProvider {
  render(event: ContainerRuntimeEvent): void;
}

export interface ContainerRuntimeOptions {
  readonly ui?: ContainerUiProvider;
}

export interface LynxShipContainerControls {
  prepare?(request: ContainerPrepareRequest): Promise<void>;
  reload?(request?: ContainerMountRequest): Promise<ContainerMountResult>;
  /** Updates initData without remounting the active Lynx template. */
  updateData?(data: string, processorName?: string): Promise<void>;
  updateGlobalProps?(props: Readonly<Record<string, unknown>>): Promise<void>;
  /** Applies a partial global-props update without remounting the container. */
  updateGlobalPropsByIncrement?(
    props: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  sendGlobalEvent?(
    eventName: string,
    params: readonly unknown[],
  ): Promise<void>;
  show?(): Promise<void>;
  hide?(): Promise<void>;
  updateViewport?(viewport: ContainerViewport): Promise<void>;
}

export type RuntimeContainer = LynxShipContainer & LynxShipContainerControls;

export interface ContainerRuntime {
  readonly platform: LynxShipContainer["platform"];
  readonly loadState: ContainerLoadState;
  readonly currentBundle: BundleReference | undefined;
  prepare(request: ContainerPrepareRequest): Promise<void>;
  mount(request: ContainerMountRequest): Promise<ContainerMountResult>;
  update(request: ContainerUpdateRequest): Promise<void>;
  reload(request?: ContainerMountRequest): Promise<ContainerMountResult>;
  updateData(data: string, processorName?: string): Promise<void>;
  updateGlobalProps(props: Readonly<Record<string, unknown>>): Promise<void>;
  updateGlobalPropsByIncrement(
    props: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  sendGlobalEvent(
    eventName: string,
    params?: readonly unknown[],
  ): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  updateViewport(viewport: ContainerViewport): Promise<void>;
  unmount(): Promise<void>;
  subscribe(listener: (event: ContainerRuntimeEvent) => void): () => void;
}

function missingCapability(capability: string): FrameworkError {
  return new FrameworkError(
    "FRAMEWORK_CONTAINER_CAPABILITY_MISSING",
    `The native container does not implement ${capability}.`,
    { capability },
  );
}

function validateViewport(viewport: ContainerViewport): void {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width < 0 ||
    viewport.height < 0
  )
    throw new FrameworkError(
      "FRAMEWORK_CONTAINER_VIEWPORT_INVALID",
      "Container viewport dimensions must be finite and non-negative.",
    );
}

function validateContainerData(data: string): void {
  if (typeof data !== "string" || data.length > 8 * 1024 * 1024)
    throw new FrameworkError(
      "FRAMEWORK_CONTAINER_DATA_INVALID",
      "Container update data must be a string no larger than 8 MiB.",
    );
}

function validateProcessorName(processorName: string | undefined): void {
  if (
    processorName !== undefined &&
    (!processorName.trim() ||
      processorName.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(processorName))
  )
    throw new FrameworkError(
      "FRAMEWORK_CONTAINER_PROCESSOR_INVALID",
      "The Lynx data processor name is invalid.",
    );
}

/**
 * Adds explicit container controls without making the portable framework
 * depend on Android, iOS, or a particular UI toolkit.
 */
export function createContainerRuntime(
  container: RuntimeContainer,
  options: ContainerRuntimeOptions = {},
): ContainerRuntime {
  const operations = new ExclusiveOperationQueue();
  const listeners = new Set<(event: ContainerRuntimeEvent) => void>();
  let loadState: ContainerLoadState = "idle";
  let currentBundle: BundleReference | undefined;
  let released = false;
  let intrinsicSizeUnsubscribe: (() => void) | undefined;

  const emit = (event: ContainerRuntimeEvent): void => {
    for (const listener of listeners) listener(event);
    try {
      options.ui?.render(event);
    } catch {
      // Presentation must never turn a successful native lifecycle operation
      // into a failed container operation.
    }
  };
  const ensureActive = (): void => {
    if (released)
      throw new FrameworkError(
        "FRAMEWORK_CONTAINER_RELEASED",
        "The native container has already been released.",
      );
  };
  const withFirstScreen = (
    bundle: BundleReference,
    result: ContainerMountResult,
  ): ContainerMountResult => ({
    ...result,
    firstScreen: result.firstScreen.then(
      () => {
        if (!released) {
          loadState = "loaded";
          emit({ type: "first-screen", bundle });
        }
      },
      (error: unknown) => {
        if (!released) {
          loadState = "failed";
          emit({ type: "error", error });
        }
        throw error;
      },
    ),
  });

  const clearIntrinsicSizeSubscription = (): void => {
    if (!intrinsicSizeUnsubscribe) return;
    try {
      intrinsicSizeUnsubscribe();
    } finally {
      intrinsicSizeUnsubscribe = undefined;
    }
  };
  const reportIntrinsicSize = (size: ContainerSize): void => {
    try {
      validateViewport(size);
      if (!released) emit({ type: "intrinsic-size", size });
    } catch (error) {
      if (!released) emit({ type: "error", error });
    }
  };
  const observeIntrinsicSize = (result: ContainerMountResult): void => {
    clearIntrinsicSizeSubscription();
    if (result.subscribeIntrinsicSize)
      intrinsicSizeUnsubscribe =
        result.subscribeIntrinsicSize(reportIntrinsicSize);
    if (result.intrinsicSize !== undefined)
      void Promise.resolve(result.intrinsicSize).then(
        reportIntrinsicSize,
        (error: unknown) => {
          if (!released) emit({ type: "error", error });
        },
      );
  };

  return {
    platform: container.platform,
    get loadState() {
      return loadState;
    },
    get currentBundle() {
      return currentBundle;
    },
    prepare(request) {
      return operations.run(async () => {
        ensureActive();
        validateBundleReference(request.bundle);
        emit({ type: "prepare-start", bundle: request.bundle });
        try {
          if (!container.prepare) throw missingCapability("prepare");
          await container.prepare(request);
          emit({ type: "prepared", bundle: request.bundle });
        } catch (error) {
          emit({ type: "error", error });
          throw error;
        }
      });
    },
    mount(request) {
      return operations.run(async () => {
        ensureActive();
        validateContainerMountRequest(request);
        loadState = "loading";
        currentBundle = request.bundle;
        clearIntrinsicSizeSubscription();
        emit({ type: "load-start", bundle: request.bundle });
        try {
          const result = withFirstScreen(
            request.bundle,
            await container.mount(request),
          );
          observeIntrinsicSize(result);
          return result;
        } catch (error) {
          loadState = "failed";
          emit({ type: "error", error });
          throw error;
        }
      });
    },
    update(request) {
      return operations.run(async () => {
        ensureActive();
        validateBundleReference(request.bundle);
        try {
          await container.update(request);
          currentBundle = request.bundle;
          loadState = "loaded";
          emit({ type: "update", bundle: request.bundle });
        } catch (error) {
          loadState = "failed";
          emit({ type: "error", error });
          throw error;
        }
      });
    },
    reload(request) {
      return operations.run(async () => {
        ensureActive();
        const target =
          request ?? (currentBundle ? { bundle: currentBundle } : undefined);
        if (!target)
          throw new FrameworkError(
            "FRAMEWORK_CONTAINER_NOT_LOADED",
            "Cannot reload a container before its first bundle is known.",
          );
        validateContainerMountRequest(target);
        loadState = "loading";
        clearIntrinsicSizeSubscription();
        emit({ type: "load-start", bundle: target.bundle });
        try {
          const result = container.reload
            ? await container.reload(target)
            : await container.mount(target);
          currentBundle = target.bundle;
          const wrapped = withFirstScreen(target.bundle, result);
          observeIntrinsicSize(wrapped);
          return wrapped;
        } catch (error) {
          loadState = "failed";
          emit({ type: "error", error });
          throw error;
        }
      });
    },
    updateData(data, processorName) {
      return operations.run(async () => {
        ensureActive();
        validateContainerData(data);
        validateProcessorName(processorName);
        if (!container.updateData) throw missingCapability("updateData");
        await container.updateData(data, processorName);
        if (currentBundle) emit({ type: "data-update", bundle: currentBundle });
      });
    },
    updateGlobalProps(props) {
      return operations.run(async () => {
        ensureActive();
        const update =
          container.updateGlobalPropsByIncrement ?? container.updateGlobalProps;
        if (!update) throw missingCapability("updateGlobalPropsByIncrement");
        await update(props);
      });
    },
    updateGlobalPropsByIncrement(props) {
      return operations.run(async () => {
        ensureActive();
        const update =
          container.updateGlobalPropsByIncrement ?? container.updateGlobalProps;
        if (!update) throw missingCapability("updateGlobalPropsByIncrement");
        await update(props);
      });
    },
    sendGlobalEvent(eventName, params = []) {
      return operations.run(async () => {
        ensureActive();
        if (!container.sendGlobalEvent)
          throw missingCapability("sendGlobalEvent");
        await container.sendGlobalEvent(eventName, params);
      });
    },
    show() {
      return operations.run(async () => {
        ensureActive();
        if (!container.show) throw missingCapability("show");
        await container.show();
        emit({ type: "show" });
      });
    },
    hide() {
      return operations.run(async () => {
        ensureActive();
        if (!container.hide) throw missingCapability("hide");
        await container.hide();
        emit({ type: "hide" });
      });
    },
    updateViewport(viewport) {
      return operations.run(async () => {
        ensureActive();
        validateViewport(viewport);
        if (!container.updateViewport)
          throw missingCapability("updateViewport");
        await container.updateViewport(viewport);
        emit({ type: "viewport", viewport });
      });
    },
    unmount() {
      return operations.run(async () => {
        if (released) return;
        try {
          await container.unmount();
        } finally {
          clearIntrinsicSizeSubscription();
          released = true;
          loadState = "released";
          currentBundle = undefined;
          emit({ type: "released" });
          listeners.clear();
        }
      });
    },
    subscribe(listener) {
      if (released)
        throw new FrameworkError(
          "FRAMEWORK_CONTAINER_RELEASED",
          "Cannot subscribe to a released container.",
        );
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
