import {
  createElement,
  forwardRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { requireNativeViewManager } from "expo-modules-core";
import type { ViewProps } from "react-native";
import {
  validateLynxShipExpoConfig,
  type LynxShipExpoConfig,
} from "./config.js";

export type { LynxShipExpoConfig } from "./config.js";

export { validateLynxShipExpoConfig } from "./config.js";

export interface LynxViewProps extends ViewProps {
  /** Bundle name resolved by the native Lynx template provider. */
  bundle?: string;
  /** Optional initial data passed to Lynx when the view is rendered. */
  initialData?: string;
  /** Global props exposed as `lynx.__globalProps` in the loaded Lynx page. */
  globalProps?: Readonly<Record<string, unknown>>;
  /** Injects the standard OS, size, safe-area and lifecycle host props. */
  autoGlobalProps?: boolean;
  /** Requests a fresh render after an OTA candidate has been activated. */
  reloadOnUpdate?: boolean;
  /** Emitted after Lynx reports that the first screen layout completed. */
  onReady?: (event: LynxViewReadyEvent) => void;
  /** Emitted when Lynx begins loading a bundle. */
  onLoadStart?: (event: LynxViewLoadStartEvent) => void;
  /** Emitted when the native provider starts fetching bundle bytes. */
  onResourceFetchStart?: (event: LynxViewResourceFetchStartEvent) => void;
  /** Emitted when the first rendered screen is available. */
  onLoadSuccess?: (event: LynxViewReadyEvent) => void;
  /** Emitted when the native host or bundle provider reports an error. */
  onError?: (event: LynxViewErrorEvent) => void;
  /** Emitted after a verified OTA candidate has been activated. */
  onUpdate?: (event: LynxViewUpdateEvent) => void;
  /** Emitted when the native Lynx view becomes visible. */
  onShow?: () => void;
  /** Emitted when the native Lynx view leaves the window. */
  onHide?: () => void;
}

export interface LynxViewLoadStartEvent {
  readonly nativeEvent: { readonly bundle: string };
}

export interface LynxViewResourceFetchStartEvent {
  readonly nativeEvent: { readonly bundle: string };
}

export interface LynxViewReadyEvent {
  readonly nativeEvent: {
    readonly bundle: string;
    readonly sequence: number;
  };
}

export interface LynxViewErrorEvent {
  readonly nativeEvent: {
    readonly message: string;
    readonly recoverable?: boolean;
  };
}

export interface LynxViewUpdateEvent {
  readonly nativeEvent: {
    readonly sequence: number;
  };
}

export interface LynxViewViewport {
  readonly width: number;
  readonly height: number;
}

export type LynxViewLoadState =
  | "idle"
  | "loading"
  | "loaded"
  | "failed"
  | "released";

/** Imperative controls implemented by the native LynxView ref. */
export interface LynxViewRef {
  getContainerId(): Promise<string>;
  getLoadState(): Promise<LynxViewLoadState>;
  isLoadSuccess(): Promise<boolean>;
  reload(): Promise<void>;
  /** Updates Lynx initData without remounting the native view. */
  updateData(data: string, processorName?: string): Promise<void>;
  updateGlobalProps(props: Readonly<Record<string, unknown>>): Promise<void>;
  /** Merges a partial global-props patch without remounting the Lynx page. */
  updateGlobalPropsByIncrement(
    props: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  sendGlobalEvent(
    eventName: string,
    params?: readonly unknown[],
  ): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  updateViewport(viewport: LynxViewViewport): Promise<void>;
}

const NativeLynxView = requireNativeViewManager<
  LynxViewProps & { ref?: LynxViewRef | null }
>("LynxShip");

/**
 * A LynxView that can be placed anywhere in an Expo/React Native view tree.
 * Native OTA configuration is supplied by the LynxShip config plugin.
 */
export const LynxView = forwardRef<LynxViewRef, LynxViewProps>(
  (props, ref): ReactNode =>
    createElement(NativeLynxView, {
      bundle: props.bundle ?? "main.lynx.bundle",
      initialData: props.initialData ?? "",
      globalProps: props.globalProps ?? {},
      autoGlobalProps: props.autoGlobalProps ?? true,
      reloadOnUpdate: props.reloadOnUpdate ?? true,
      ...props,
      ref,
    }),
);

export const LynxShipView: ComponentType<LynxViewProps> = LynxView;

export function defineLynxShipExpoConfig(
  config: LynxShipExpoConfig,
): LynxShipExpoConfig {
  return validateLynxShipExpoConfig(config);
}
