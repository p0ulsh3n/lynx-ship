import {
  FrameworkError,
  type FrameworkPlatform,
} from "../contracts/platform.js";

export type GlobalPropsTheme = "light" | "dark" | "system";

export type GlobalPropsOrientation =
  | "portrait"
  | "portrait-upside-down"
  | "landscape-left"
  | "landscape-right"
  | "landscape"
  | "unknown";

export interface GlobalPropsInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Standard host context exposed to every Lynx container when available. */
export interface LynxShipGlobalProps {
  readonly os: FrameworkPlatform;
  readonly osVersion?: string;
  readonly deviceModel?: string;
  readonly containerID: string;
  readonly containerInitTime?: string;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly safeAreaInsets: GlobalPropsInsets;
  readonly pixelRatio: number;
  readonly accessibleMode?: number;
  readonly isIPhoneX?: number;
  readonly isIPhoneXMax?: number;
  readonly isPad?: number;
  readonly isNotchScreen?: boolean;
  readonly isLowPowerMode?: number;
  readonly lynxSdkVersion?: string;
  readonly templateResData?: string;
  readonly statusBarHeight?: number;
  readonly navigationBarHeight?: number;
  readonly topHeight?: number;
  readonly bottomHeight?: number;
  readonly orientation: GlobalPropsOrientation;
  readonly screenOrientation: GlobalPropsOrientation;
  readonly theme: GlobalPropsTheme;
  readonly appLanguage?: string;
  readonly appLocale?: string;
  readonly isAppBackground: boolean;
  readonly queryItems: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface GlobalPropsContext {
  readonly os: FrameworkPlatform;
  readonly osVersion?: string;
  readonly deviceModel?: string;
  readonly containerID: string;
  readonly containerInitTime?: string;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly safeAreaInsets: GlobalPropsInsets;
  readonly pixelRatio: number;
  readonly accessibleMode?: number;
  readonly isIPhoneX?: number;
  readonly isIPhoneXMax?: number;
  readonly isPad?: number;
  readonly isNotchScreen?: boolean;
  readonly isLowPowerMode?: number;
  readonly lynxSdkVersion?: string;
  readonly templateResData?: string;
  readonly statusBarHeight?: number;
  readonly navigationBarHeight?: number;
  readonly topHeight?: number;
  readonly bottomHeight?: number;
  readonly orientation: GlobalPropsOrientation;
  readonly screenOrientation: GlobalPropsOrientation;
  readonly theme: GlobalPropsTheme;
  readonly appLanguage?: string;
  readonly appLocale?: string;
  readonly isAppBackground: boolean;
  readonly queryItems: Readonly<Record<string, string>>;
}

const STANDARD_KEYS = new Set([
  "os",
  "osVersion",
  "deviceModel",
  "containerID",
  "containerInitTime",
  "screenWidth",
  "screenHeight",
  "contentWidth",
  "contentHeight",
  "safeAreaInsets",
  "pixelRatio",
  "accessibleMode",
  "isIPhoneX",
  "isIPhoneXMax",
  "isPad",
  "isNotchScreen",
  "isLowPowerMode",
  "lynxSdkVersion",
  "templateResData",
  "statusBarHeight",
  "navigationBarHeight",
  "topHeight",
  "bottomHeight",
  "orientation",
  "screenOrientation",
  "theme",
  "appLanguage",
  "appLocale",
  "isAppBackground",
  "queryItems",
]);

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new FrameworkError("FRAMEWORK_GLOBAL_PROPS_INVALID", message, details);
}

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    invalid(`${name} must be finite and non-negative.`, { name, value });
}

const PLATFORMS = new Set<FrameworkPlatform>([
  "android",
  "ios",
  "harmony",
  "web",
  "desktop",
]);

const ORIENTATIONS = new Set<GlobalPropsOrientation>([
  "portrait",
  "portrait-upside-down",
  "landscape-left",
  "landscape-right",
  "landscape",
  "unknown",
]);

function validateInsets(insets: GlobalPropsInsets): void {
  for (const [name, value] of Object.entries(insets))
    finiteNonNegative(value, `safeAreaInsets.${name}`);
}

export function validateGlobalProps(props: GlobalPropsContext): void {
  if (!PLATFORMS.has(props.os))
    invalid("os must be a supported LynxShip framework platform.", {
      os: props.os,
    });
  if (
    !props.containerID ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(props.containerID)
  )
    invalid("containerID must be a safe non-empty identifier.");
  finiteNonNegative(props.screenWidth, "screenWidth");
  finiteNonNegative(props.screenHeight, "screenHeight");
  finiteNonNegative(props.contentWidth, "contentWidth");
  finiteNonNegative(props.contentHeight, "contentHeight");
  if (!Number.isFinite(props.pixelRatio) || props.pixelRatio <= 0)
    invalid("pixelRatio must be finite and greater than zero.", {
      pixelRatio: props.pixelRatio,
    });
  if (
    props.containerInitTime !== undefined &&
    (!props.containerInitTime.trim() || props.containerInitTime.length > 128)
  )
    invalid("containerInitTime must be a non-empty short timestamp.");
  if (
    props.accessibleMode !== undefined &&
    (!Number.isSafeInteger(props.accessibleMode) || props.accessibleMode < 0)
  )
    invalid("accessibleMode must be a non-negative integer bitmask.");
  if (
    props.isIPhoneX !== undefined &&
    props.isIPhoneX !== 0 &&
    props.isIPhoneX !== 1
  )
    invalid("isIPhoneX must be 0 or 1.");
  for (const [name, value] of [
    ["isIPhoneXMax", props.isIPhoneXMax],
    ["isPad", props.isPad],
    ["isLowPowerMode", props.isLowPowerMode],
  ] as const)
    if (value !== undefined && value !== 0 && value !== 1)
      invalid(`${name} must be 0 or 1.`, { name, value });
  if (
    props.isNotchScreen !== undefined &&
    typeof props.isNotchScreen !== "boolean"
  )
    invalid("isNotchScreen must be a boolean.");
  for (const [name, value] of [
    ["statusBarHeight", props.statusBarHeight],
    ["navigationBarHeight", props.navigationBarHeight],
    ["topHeight", props.topHeight],
    ["bottomHeight", props.bottomHeight],
  ] as const)
    if (value !== undefined) finiteNonNegative(value, name);
  validateInsets(props.safeAreaInsets);
  if (!ORIENTATIONS.has(props.orientation))
    invalid("orientation is not a supported value.", {
      orientation: props.orientation,
    });
  if (!ORIENTATIONS.has(props.screenOrientation))
    invalid("screenOrientation is not a supported value.", {
      screenOrientation: props.screenOrientation,
    });
  if (!(["light", "dark", "system"] as const).includes(props.theme))
    invalid("theme is not a supported value.", { theme: props.theme });
  if (typeof props.isAppBackground !== "boolean")
    invalid("isAppBackground must be a boolean.");
  if (!props.queryItems || typeof props.queryItems !== "object")
    invalid("queryItems must be an object.");
  for (const [key, value] of Object.entries(props.queryItems))
    if (!key || typeof value !== "string")
      invalid("queryItems must contain string keys and values.", { key });
}

/**
 * Creates a stable, Sparkling-compatible host context without allowing app
 * extras to overwrite reserved platform fields.
 */
export function createGlobalProps(
  context: GlobalPropsContext,
  extras: Readonly<Record<string, unknown>> = {},
): LynxShipGlobalProps {
  validateGlobalProps(context);
  for (const key of Object.keys(extras))
    if (STANDARD_KEYS.has(key))
      invalid(`Global prop ${key} is reserved and cannot be overridden.`, {
        key,
      });
  return Object.freeze({
    ...context,
    safeAreaInsets: Object.freeze({ ...context.safeAreaInsets }),
    queryItems: Object.freeze({ ...context.queryItems }),
    ...extras,
  });
}
