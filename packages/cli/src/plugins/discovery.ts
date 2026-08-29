import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Platform } from "@lynxship/contracts";
import {
  type JsonObject,
  type LynxShipPluginDefinition,
  type PluginPlatform,
  type PluginReference,
} from "@lynxship/plugin-api";
import type { LynxShipConfig } from "../config.js";

import type { ProjectPluginInfo, PluginReport } from "./contracts.js";
import {
  capabilities,
  isKnownList,
  LYNXSHIP_PLUGIN_API_VERSION,
  KNOWN_CAPABILITIES,
  KNOWN_PERMISSIONS,
  permissions,
  validPluginDefinition,
} from "./validation.js";

interface PluginPackageJson {
  name?: unknown;
  version?: unknown;
  main?: unknown;
  lynxship?: {
    apiVersion?: unknown;
    plugin?: unknown;
    capabilities?: unknown;
    permissions?: unknown;
  };
}

export interface ResolvedPlugin {
  info: ProjectPluginInfo;
  definition?: LynxShipPluginDefinition;
}

export function pluginReference(reference: PluginReference): {
  name: string;
  options: JsonObject;
} {
  if (typeof reference === "string") return { name: reference, options: {} };
  return { name: reference[0], options: reference[1] };
}

function packageDirectory(entry: string): string {
  let current = dirname(entry);
  while (true) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return dirname(entry);
    current = parent;
  }
}

function parsePackageJson(file: string): PluginPackageJson {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PluginPackageJson;
  } catch {
    return {};
  }
}

function packageJsonFromEntry(entry: string): string {
  return join(packageDirectory(entry), "package.json");
}

function findInstalledPackageJson(
  root: string,
  name: string,
): string | undefined {
  let current = root;
  while (true) {
    const candidate = join(
      current,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function resolvePackageEntry(
  root: string,
  name: string,
): {
  packagePath?: string;
  entry?: string;
  reason?: string;
} {
  try {
    const requireFromProject = createRequire(join(root, "package.json"));
    let entry: string;
    let packagePath: string;
    try {
      entry = requireFromProject.resolve(name);
      packagePath = packageJsonFromEntry(entry);
    } catch {
      packagePath = findInstalledPackageJson(root, name) ?? "";
      if (!packagePath) throw new Error("Cannot find module '" + name + "'");
      entry = packagePath;
    }
    const packageJson = parsePackageJson(packagePath);
    const plugin = packageJson.lynxship?.plugin;
    if (typeof plugin !== "string" || !plugin)
      return {
        packagePath,
        reason: `${name} does not declare package.json#lynxship.plugin`,
      };
    const packageRoot = dirname(packagePath);
    const resolved = resolve(packageRoot, plugin);
    const outside = relative(packageRoot, resolved).startsWith("..");
    if (outside)
      return {
        packagePath,
        reason: `${name} points its plugin entry outside the package`,
      };
    if (!existsSync(resolved))
      return {
        packagePath,
        reason: `${name} plugin entry does not exist: ${plugin}`,
      };
    return { packagePath, entry: resolved };
  } catch (error) {
    return {
      reason:
        error instanceof Error
          ? `Cannot resolve ${name}: ${error.message}`
          : `Cannot resolve ${name}`,
    };
  }
}

export async function resolvePlugin(
  root: string,
  reference: PluginReference,
  load = true,
): Promise<ResolvedPlugin> {
  const requested = pluginReference(reference);
  const resolved = resolvePackageEntry(root, requested.name);
  if (!resolved.packagePath || !resolved.entry) {
    return {
      info: {
        name: requested.name,
        capabilities: [],
        permissions: [],
        status: "missing",
        reason: resolved.reason ?? "Plugin package was not found",
      },
    };
  }
  const packageJson = parsePackageJson(resolved.packagePath);
  const metadata = packageJson.lynxship;
  const apiVersion =
    typeof metadata?.apiVersion === "number" ? metadata.apiVersion : undefined;
  const packageCapabilities = capabilities(metadata?.capabilities);
  const packagePermissions = permissions(metadata?.permissions);
  if (
    !isKnownList(metadata?.capabilities, KNOWN_CAPABILITIES) ||
    !isKnownList(metadata?.permissions, KNOWN_PERMISSIONS)
  ) {
    return {
      info: {
        name: requested.name,
        version:
          typeof packageJson.version === "string"
            ? packageJson.version
            : undefined,
        packagePath: resolved.packagePath,
        entry: resolved.entry,
        apiVersion,
        capabilities: packageCapabilities,
        permissions: packagePermissions,
        status: "invalid",
        reason:
          "Plugin package capabilities and permissions must be arrays of known values",
      },
    };
  }
  if (apiVersion !== LYNXSHIP_PLUGIN_API_VERSION) {
    return {
      info: {
        name: requested.name,
        version:
          typeof packageJson.version === "string"
            ? packageJson.version
            : undefined,
        packagePath: resolved.packagePath,
        entry: resolved.entry,
        apiVersion,
        capabilities: packageCapabilities,
        permissions: packagePermissions,
        status: "invalid",
        reason: `Plugin API ${String(apiVersion ?? "missing")} is not supported; expected ${LYNXSHIP_PLUGIN_API_VERSION}`,
      },
    };
  }
  const info: ProjectPluginInfo = {
    name: requested.name,
    version:
      typeof packageJson.version === "string" ? packageJson.version : undefined,
    packagePath: resolved.packagePath,
    entry: resolved.entry,
    apiVersion,
    capabilities: packageCapabilities,
    permissions: packagePermissions,
    status: "ready",
    reason: "Plugin manifest is valid",
  };
  if (!load) return { info };
  try {
    const module = (await import(pathToFileURL(resolved.entry).href)) as {
      default?: unknown;
      plugin?: unknown;
    };
    const definition = module.default ?? module.plugin;
    if (!validPluginDefinition(definition)) {
      return {
        info: {
          ...info,
          status: "invalid",
          reason: "Plugin entry must export a LynxShipPluginDefinition",
        },
      };
    }
    if (
      capabilities(definition.capabilities).join(",") !==
        packageCapabilities.join(",") ||
      permissions(definition.permissions).join(",") !==
        packagePermissions.join(",")
    ) {
      return {
        info: {
          ...info,
          status: "invalid",
          reason:
            "Plugin code capabilities/permissions do not match package.json",
        },
      };
    }
    if (
      definition.name !== requested.name &&
      definition.name !== packageJson.name
    ) {
      return {
        info: {
          ...info,
          status: "invalid",
          reason: `Plugin entry name '${definition.name}' does not match its package`,
        },
      };
    }
    return { info, definition };
  } catch (error) {
    return {
      info: {
        ...info,
        status: "invalid",
        reason:
          error instanceof Error
            ? `Plugin entry failed to load: ${error.message}`
            : "Plugin entry failed to load",
      },
    };
  }
}

export function pluginReferences(config: LynxShipConfig): PluginReference[] {
  const value = config.plugins;
  if (!Array.isArray(value)) return [];
  return value as PluginReference[];
}

export async function inspectProjectPlugins(
  root: string,
  config: LynxShipConfig,
): Promise<PluginReport> {
  const references = pluginReferences(config);
  const plugins = await Promise.all(
    references.map(
      async (reference) => (await resolvePlugin(root, reference, false)).info,
    ),
  );
  return { configured: references.length, plugins };
}

export function appliesToPlatform(
  platforms: readonly PluginPlatform[] | undefined,
  platform: Platform,
): boolean {
  return (
    !platforms ||
    platforms.length === 0 ||
    platforms.includes("all") ||
    platforms.includes(platform)
  );
}

export function mergeJson(left: JsonObject, right: JsonObject): JsonObject {
  const result: JsonObject = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const current = result[key];
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = mergeJson(current as JsonObject, value as JsonObject);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function safeProjectFile(root: string, file: string): string {
  if (isAbsolute(file))
    throw new Error(`Plugin native file must be relative: ${file}`);
  const target = resolve(root, file);
  const projectRelative = relative(root, target);
  if (
    !projectRelative ||
    projectRelative.startsWith("..") ||
    isAbsolute(projectRelative)
  )
    throw new Error(`Plugin native file escapes the project: ${file}`);
  return target;
}
