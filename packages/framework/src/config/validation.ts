import { FrameworkError } from "../contracts/platform.js";
import type {
  LynxShipAppConfig,
  LynxShipPlatformConfig,
  LynxShipRouteEntry,
  LynxShipRouteConfig,
} from "./contracts.js";

const PLATFORMS = ["android", "ios", "harmony", "web", "desktop"] as const;
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const BUNDLE_ID = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new FrameworkError("FRAMEWORK_CONFIG_INVALID", message, details);
}

function relativePath(value: string, field: string): void {
  if (
    !value.trim() ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").includes("..")
  )
    invalid(`${field} must be a non-empty portable relative path.`);
}

function routePath(value: string, field: string): void {
  if (
    !value.trim() ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.split("/").includes("..") ||
    !value.startsWith("/")
  )
    invalid(`${field} must be a non-empty absolute route path without '..'.`);
}

function routeEntry(value: LynxShipRouteEntry, field: string): void {
  if (typeof value !== "object" || value === null)
    invalid(`${field} must be an object.`);
  if (typeof value.bundle !== "string" || !value.bundle.trim())
    invalid(`${field}.bundle must be a non-empty relative bundle path.`);
  relativePath(value.bundle, `${field}.bundle`);
  if (value.path !== undefined) routePath(value.path, `${field}.path`);
  if (
    value.title !== undefined &&
    (typeof value.title !== "string" || value.title.length > 256)
  )
    invalid(`${field}.title must be at most 256 characters.`);
  if (value.params !== undefined) {
    if (
      typeof value.params !== "object" ||
      value.params === null ||
      Array.isArray(value.params)
    )
      invalid(`${field}.params must be a JSON object.`);
    for (const [key, parameter] of Object.entries(value.params)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key))
        invalid(`${field}.params contains an unsafe key.`);
      if (
        !["string", "number", "boolean"].includes(typeof parameter) ||
        (typeof parameter === "number" && !Number.isFinite(parameter))
      )
        invalid(
          `${field}.params.${key} must be a finite string, number or boolean.`,
        );
    }
  }
}

function color(value: string, field: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(value))
    invalid(`${field} must be a six-digit RGB color.`);
}

function scheme(value: string, field: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid(`${field} must be an absolute URL scheme.`);
  }
  if (!parsed.protocol || !parsed.hostname)
    invalid(`${field} must include a scheme and host.`);
}

function validatePlatform(
  value: LynxShipPlatformConfig,
  platform: string,
): void {
  if (typeof value !== "object" || value === null)
    invalid(`platform.${platform} must be an object.`);
  if (value.packageName !== undefined && !PACKAGE_NAME.test(value.packageName))
    invalid(`platform.${platform}.packageName is invalid.`);
  if (
    value.bundleIdentifier !== undefined &&
    !BUNDLE_ID.test(value.bundleIdentifier)
  )
    invalid(`platform.${platform}.bundleIdentifier is invalid.`);
  if (value.simulator !== undefined) {
    if (!value.simulator.trim() || value.simulator.length > 256)
      invalid(
        `platform.${platform}.simulator must be between 1 and 256 characters.`,
      );
  }
}

function validateRoute(value: LynxShipRouteConfig, index: number): void {
  if (typeof value !== "object" || value === null)
    invalid(`routes[${index}] must be an object.`);
  if (!value.name.trim() || value.name.length > 128)
    invalid(`routes[${index}].name must be between 1 and 128 characters.`);
  if (!value.bundle.trim() || value.bundle.length > 512)
    invalid(`routes[${index}].bundle must be between 1 and 512 characters.`);
  if (value.path !== undefined) routePath(value.path, `routes[${index}].path`);
}

/** Validate without loading Rspeedy, native modules, the filesystem or plugins. */
export function validateLynxShipAppConfig(
  config: LynxShipAppConfig,
): LynxShipAppConfig {
  if (typeof config !== "object" || config === null)
    invalid("The LynxShip app config must be an object.");
  if (!("lynxConfig" in config))
    invalid("The LynxShip app config must provide lynxConfig.");
  if (
    config.appName !== undefined &&
    (!config.appName.trim() || config.appName.length > 128)
  )
    invalid("appName must be between 1 and 128 characters.");
  if (config.appIcon !== undefined) relativePath(config.appIcon, "appIcon");
  if (config.splashScreen !== undefined) {
    if (typeof config.splashScreen !== "object" || config.splashScreen === null)
      invalid("splashScreen must be an object.");
    if (config.splashScreen.backgroundColor !== undefined)
      color(
        config.splashScreen.backgroundColor,
        "splashScreen.backgroundColor",
      );
    if (config.splashScreen.image !== undefined)
      relativePath(config.splashScreen.image, "splashScreen.image");
    if (
      config.splashScreen.imageWidth !== undefined &&
      (!Number.isSafeInteger(config.splashScreen.imageWidth) ||
        config.splashScreen.imageWidth < 1 ||
        config.splashScreen.imageWidth > 4096)
    )
      invalid("splashScreen.imageWidth must be an integer between 1 and 4096.");
  }
  if (config.router !== undefined) {
    if (typeof config.router !== "object" || config.router === null)
      invalid("router must be an object.");
    if (config.router.baseScheme !== undefined)
      scheme(config.router.baseScheme, "router.baseScheme");
    if (config.router.initialRoute !== undefined)
      routePath(config.router.initialRoute, "router.initialRoute");
    if (config.router.main !== undefined)
      routeEntry(config.router.main, "router.main");
    for (const [name, entry] of Object.entries(config.router.routes ?? {})) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(name))
        invalid("router.routes contains an unsafe route name.");
      routeEntry(entry, `router.routes.${name}`);
    }
  }

  for (const [platform, path] of Object.entries(config.paths ?? {})) {
    if (!(PLATFORMS as readonly string[]).includes(platform))
      invalid(`paths.${platform} is not a supported platform.`);
    if (typeof path !== "string")
      invalid(`paths.${platform} must be a string.`);
    relativePath(path, `paths.${platform}`);
  }
  for (const [platform, value] of Object.entries(config.platform ?? {})) {
    if (!(PLATFORMS as readonly string[]).includes(platform))
      invalid(`platform.${platform} is not a supported platform.`);
    validatePlatform(value, platform);
  }

  const seenRoutes = new Set<string>();
  for (const [index, route] of (config.routes ?? []).entries()) {
    validateRoute(route, index);
    if (seenRoutes.has(route.name))
      invalid(`routes contains duplicate name ${route.name}.`);
    seenRoutes.add(route.name);
  }

  const seenPlugins = new Set<string>();
  for (const [index, plugin] of [
    ...(config.plugins ?? []),
    ...(config.plugin ?? []),
  ].entries()) {
    if (
      !Array.isArray(plugin) ||
      typeof plugin[0] !== "string" ||
      !plugin[0].trim()
    )
      invalid(`plugins[${index}] must be a non-empty [name, options] tuple.`);
    if (seenPlugins.has(plugin[0]))
      invalid(`plugins contains duplicate name ${plugin[0]}.`);
    seenPlugins.add(plugin[0]);
  }
  return config;
}

export function defineLynxShipAppConfig(
  config: LynxShipAppConfig,
): LynxShipAppConfig {
  return validateLynxShipAppConfig(config);
}

/**
 * Returns one canonical route/plugin view while retaining the source config.
 * This lets tooling consume both LynxShip's plural fields and Sparkling-style
 * app.config.ts aliases without making either authoring format mandatory.
 */
export function normalizeLynxShipAppConfig(
  config: LynxShipAppConfig,
): LynxShipAppConfig {
  validateLynxShipAppConfig(config);
  const plugins = [...(config.plugins ?? []), ...(config.plugin ?? [])];
  const routerRoutes = Object.entries(config.router?.routes ?? {}).map(
    ([name, entry]) => ({
      name,
      bundle: entry.bundle,
      path: entry.path,
    }),
  );
  const main = config.router?.main;
  const routes = [
    ...(config.routes ?? []),
    ...(main ? [{ name: "main", bundle: main.bundle, path: main.path }] : []),
    ...routerRoutes,
  ];
  const seenRoutes = new Set<string>();
  const uniqueRoutes = routes.filter((route) => {
    if (seenRoutes.has(route.name)) return false;
    seenRoutes.add(route.name);
    return true;
  });
  return {
    ...config,
    plugins,
    routes: uniqueRoutes,
  };
}
