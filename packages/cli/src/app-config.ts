import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createJiti } from "jiti";
import { join, relative, resolve } from "node:path";
import { LynxShipError, type Platform } from "@lynxship/contracts";
import {
  FrameworkError,
  normalizeLynxShipAppConfig,
  type LynxShipAppConfig,
} from "@lynxship/framework";

const APP_CONFIG_FILES = [
  "app.config.ts",
  "app.config.js",
  "app.config.mts",
  "app.config.mjs",
  "app.config.cts",
  "app.config.cjs",
] as const;

const MAX_APP_CONFIG_BYTES = 512 * 1024;

export interface AppConfigFactoryContext {
  readonly command: "build" | "dev" | "doctor";
  readonly env: string;
}

export interface LoadedLynxShipAppConfig {
  readonly path: string;
  readonly config: LynxShipAppConfig;
}

function appConfigError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): LynxShipError {
  return new LynxShipError(code, message, details);
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || relativePath.split(/[\\/]/u)[0] !== "..";
}

/** Find the single Sparkling-compatible app config without executing it. */
export function findAppConfig(root: string): string | undefined {
  const matches = APP_CONFIG_FILES.map((file) => join(root, file)).filter(
    (file) => existsSync(file),
  );
  if (matches.length > 1) {
    throw appConfigError(
      "CLI_APP_CONFIG_AMBIGUOUS",
      `Multiple app.config files were found. Keep exactly one: ${matches.join(", ")}`,
      { files: matches },
    );
  }
  return matches[0];
}

async function readConfigSource(path: string): Promise<string> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile())
    throw appConfigError(
      "CLI_APP_CONFIG_INVALID",
      `The app config is not a regular file: ${path}`,
      { path },
    );
  if (info.size > MAX_APP_CONFIG_BYTES)
    throw appConfigError(
      "CLI_APP_CONFIG_TOO_LARGE",
      `The app config exceeds the ${MAX_APP_CONFIG_BYTES} byte limit: ${path}`,
      { path, maxBytes: MAX_APP_CONFIG_BYTES },
    );
  return readFile(path, "utf8");
}

function isLynxAppConfigSource(source: string): boolean {
  return /\blynxConfig\b/.test(source);
}

async function resolveExport(
  value: unknown,
  context: AppConfigFactoryContext,
): Promise<unknown> {
  if (typeof value === "function")
    return (value as (context: AppConfigFactoryContext) => unknown)(context);
  return value;
}

/**
 * Load and validate a Sparkling-style app.config file only on an explicit
 * command path. Discovery remains source-only so `doctor` and project scans
 * never execute arbitrary project modules accidentally.
 */
export async function loadAppConfig(
  root: string,
  options: {
    command?: AppConfigFactoryContext["command"];
    required?: boolean;
  } = {},
): Promise<LoadedLynxShipAppConfig | undefined> {
  const path = findAppConfig(root);
  if (!path) return undefined;
  const source = await readConfigSource(path);
  if (!isLynxAppConfigSource(source)) {
    if (options.required)
      throw appConfigError(
        "CLI_APP_CONFIG_LYNX_REQUIRED",
        `The app config does not expose a lynxConfig property: ${path}`,
        { path },
      );
    return undefined;
  }

  try {
    const jiti = createJiti(path, {
      fsCache: false,
      moduleCache: false,
      sourceMaps: false,
      tsconfigPaths: true,
    });
    const exported = await jiti.import<unknown>(path, { default: true });
    const value = await resolveExport(exported, {
      command: options.command ?? "build",
      env: process.env.NODE_ENV ?? "production",
    });
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw appConfigError(
        "CLI_APP_CONFIG_INVALID",
        "app.config must export an object or a function returning an object.",
        { path },
      );
    return {
      path,
      config: normalizeLynxShipAppConfig(value as LynxShipAppConfig),
    };
  } catch (error) {
    if (error instanceof LynxShipError) throw error;
    if (error instanceof FrameworkError)
      throw appConfigError(
        "CLI_APP_CONFIG_INVALID",
        `Invalid Lynx app config ${path}: ${error.message}`,
        { path, frameworkCode: error.code },
      );
    throw appConfigError(
      "CLI_APP_CONFIG_LOAD_FAILED",
      `Could not load ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { path },
    );
  }
}

/** Resolve an app.config asset destination while keeping it inside the project. */
export function resolveAppConfigAssetPath(
  root: string,
  config: LoadedLynxShipAppConfig | undefined,
  platform: Platform,
  fallback: string,
): string {
  const configured = config?.config.paths?.[platform];
  const destination = resolve(root, configured ?? fallback);
  if (!isInsideRoot(root, destination))
    throw appConfigError(
      "CLI_APP_CONFIG_PATH_OUTSIDE_PROJECT",
      `app.config paths.${platform} must remain inside the project: ${configured}`,
      { platform, path: configured },
    );
  return destination;
}

export function resolveAppConfigProjectPath(
  root: string,
  value: string | undefined,
  field: string,
): string | undefined {
  if (!value) return undefined;
  const path = resolve(root, value);
  if (!isInsideRoot(root, path))
    throw appConfigError(
      "CLI_APP_CONFIG_PATH_OUTSIDE_PROJECT",
      `app.config ${field} must remain inside the project: ${value}`,
      { field, path: value },
    );
  return path;
}
