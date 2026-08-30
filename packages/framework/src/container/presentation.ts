import type { BundleReference, ContainerPresentation } from "./contracts.js";
import type { ContainerRuntimeEvent, ContainerUiProvider } from "./runtime.js";

export type ContainerUiPhase =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "released";

/** A toolkit-neutral view model for a host's loading/error/retry UI. */
export interface ContainerUiModel {
  readonly phase: ContainerUiPhase;
  readonly visible: boolean;
  readonly bundle?: BundleReference;
  readonly error?: unknown;
  readonly canRetry: boolean;
  readonly presentation?: ContainerPresentation;
}

export interface ContainerUiControllerOptions {
  readonly presentation?: ContainerPresentation;
  readonly onRender: (model: ContainerUiModel) => void;
  /** Called only after an error, when the host's retry action is pressed. */
  readonly onRetry?: () => Promise<void>;
}

export interface ContainerUiController extends ContainerUiProvider {
  readonly snapshot: ContainerUiModel;
  retry(): Promise<void>;
}

/**
 * Converts runtime events into a stable UI model. The controller has no
 * platform or UI-toolkit dependency; a native, ReactLynx, Expo or dashboard
 * renderer can consume the same state and choose its own visual design.
 */
export function createContainerUiController(
  options: ContainerUiControllerOptions,
): ContainerUiController {
  let snapshot: ContainerUiModel = {
    phase: "idle",
    visible: true,
    canRetry: false,
    presentation: options.presentation,
  };

  const publish = (next: ContainerUiModel): void => {
    snapshot = next;
    options.onRender(snapshot);
  };

  return {
    get snapshot() {
      return snapshot;
    },
    render(event: ContainerRuntimeEvent) {
      switch (event.type) {
        case "prepare-start":
        case "load-start":
          publish({
            ...snapshot,
            phase: "loading",
            bundle: event.bundle,
            error: undefined,
            canRetry: false,
          });
          break;
        case "first-screen":
          publish({
            ...snapshot,
            phase: "ready",
            bundle: event.bundle,
            error: undefined,
            canRetry: false,
          });
          break;
        case "error":
          publish({
            ...snapshot,
            phase: "error",
            error: event.error,
            canRetry: options.onRetry !== undefined,
          });
          break;
        case "show":
          publish({ ...snapshot, visible: true });
          break;
        case "hide":
          publish({ ...snapshot, visible: false });
          break;
        case "released":
          publish({ ...snapshot, phase: "released", canRetry: false });
          break;
        default:
          break;
      }
    },
    async retry() {
      if (!snapshot.canRetry || !options.onRetry) return;
      publish({ ...snapshot, phase: "loading", canRetry: false });
      try {
        await options.onRetry();
      } catch (error) {
        publish({ ...snapshot, phase: "error", error, canRetry: true });
        throw error;
      }
    },
  };
}
