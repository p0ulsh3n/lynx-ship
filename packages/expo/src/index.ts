import { createElement, type ComponentType } from "react";
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
  /** Requests a fresh render after an OTA candidate has been activated. */
  reloadOnUpdate?: boolean;
}

const NativeLynxView = requireNativeViewManager<LynxViewProps>("LynxShip");

/**
 * A LynxView that can be placed anywhere in an Expo/React Native view tree.
 * Native OTA configuration is supplied by the LynxShip config plugin.
 */
export function LynxView(props: LynxViewProps): unknown {
  return createElement(NativeLynxView, {
    bundle: props.bundle ?? "main.lynx.bundle",
    initialData: props.initialData ?? "",
    reloadOnUpdate: props.reloadOnUpdate ?? true,
    ...props,
  });
}

export const LynxShipView: ComponentType<LynxViewProps> = LynxView;

export function defineLynxShipExpoConfig(
  config: LynxShipExpoConfig,
): LynxShipExpoConfig {
  return validateLynxShipExpoConfig(config);
}
