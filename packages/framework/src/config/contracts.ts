import type { FrameworkPlatform } from "../contracts/platform.js";

export interface LynxShipRouteConfig {
  readonly name: string;
  readonly bundle: string;
  readonly path?: string;
}

export interface LynxShipRouteEntry {
  readonly bundle: string;
  readonly path?: string;
  readonly title?: string;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
}

export type LynxShipPluginConfig = readonly [string, unknown?];

export interface LynxShipPlatformConfig {
  readonly packageName?: string;
  readonly bundleIdentifier?: string;
  readonly simulator?: string;
}

export interface LynxShipAssetPaths {
  readonly android?: string;
  readonly ios?: string;
  readonly harmony?: string;
  readonly web?: string;
  readonly desktop?: string;
}

export interface LynxShipSplashScreenConfig {
  readonly backgroundColor?: string;
  readonly image?: string;
  readonly imageWidth?: number;
}

export interface LynxShipRouterConfig {
  readonly baseScheme?: string;
  readonly initialRoute?: string;
  /** Sparkling-compatible named route metadata for app.config.ts users. */
  readonly main?: LynxShipRouteEntry;
  readonly routes?: Readonly<Record<string, LynxShipRouteEntry>>;
}

/** Framework-level configuration; `lynxConfig` remains owned by Rspeedy. */
export interface LynxShipAppConfig {
  readonly lynxConfig: unknown;
  readonly appName?: string;
  readonly appIcon?: string;
  readonly splashScreen?: LynxShipSplashScreenConfig;
  readonly router?: LynxShipRouterConfig;
  readonly paths?: LynxShipAssetPaths;
  readonly platform?: Partial<
    Record<FrameworkPlatform, LynxShipPlatformConfig>
  >;
  readonly routes?: readonly LynxShipRouteConfig[];
  readonly plugins?: readonly LynxShipPluginConfig[];
  /** Additive singular alias accepted by Sparkling-style app.config.ts files. */
  readonly plugin?: readonly LynxShipPluginConfig[];
}
