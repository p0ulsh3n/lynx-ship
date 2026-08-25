import type { Platform } from "@lynxship/contracts";

export const LYNXSHIP_PLUGIN_API_VERSION = 1 as const;

export type PluginPlatform = Platform | "all";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type PluginCapability =
  | "config"
  | "build"
  | "native"
  | "autolink"
  | "template"
  | "cloud";

export type PluginPermission =
  | "config:write"
  | "build:metadata"
  | "native:write"
  | "autolink:metadata"
  | "template:register"
  | "cloud:provider";

export type PluginReference =
  | string
  | readonly [name: string, options: JsonObject];

export interface PluginPackageMetadata {
  apiVersion: typeof LYNXSHIP_PLUGIN_API_VERSION;
  plugin: string;
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
}

export interface PluginContext {
  readonly rootDir: string;
  readonly platform: Platform;
  readonly profile: string;
  readonly projectId?: string;
  readonly mode: "plan" | "apply";
  readonly config: Readonly<JsonObject>;
  readonly options: Readonly<JsonObject>;
}

export type NativeFileOperation =
  | {
      platform: PluginPlatform;
      file: string;
      operation: "ensure-text" | "append-text";
      text: string;
    }
  | {
      platform: PluginPlatform;
      file: string;
      operation: "replace-text";
      from: string;
      to: string;
    }
  | {
      platform: PluginPlatform;
      file: string;
      operation: "json-merge";
      value: JsonObject;
    };

export interface AutolinkContribution {
  readonly packageNames?: readonly string[];
  readonly capabilities?: readonly string[];
}

export interface TemplateContribution {
  readonly id: string;
  readonly displayName: string;
  readonly source: string;
  readonly platforms?: readonly PluginPlatform[];
}

export interface CloudIntegrationContribution {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: readonly (
    | "build"
    | "artifacts"
    | "updates"
    | "submit"
  )[];
  readonly documentation?: string;
}

export interface BuildContribution {
  readonly requiredTools?: readonly string[];
  readonly artifactExtensions?: readonly string[];
  readonly notes?: readonly string[];
}

export interface PluginContribution {
  readonly config?: JsonObject;
  readonly build?: BuildContribution;
  readonly native?: readonly NativeFileOperation[];
  readonly autolink?: AutolinkContribution;
  readonly templates?: readonly TemplateContribution[];
  readonly cloud?: readonly CloudIntegrationContribution[];
}

export interface PluginPlanChange {
  readonly plugin: string;
  readonly platform: Platform;
  readonly file: string;
  readonly operation: NativeFileOperation["operation"];
  readonly changed: boolean;
}

export type LynxShipPlugin = (
  context: PluginContext,
) => PluginContribution | void | Promise<PluginContribution | void>;

export interface LynxShipPluginDefinition {
  readonly apiVersion: typeof LYNXSHIP_PLUGIN_API_VERSION;
  readonly name: string;
  readonly version?: string;
  readonly capabilities: readonly PluginCapability[];
  readonly permissions: readonly PluginPermission[];
  readonly platforms?: readonly PluginPlatform[];
  readonly apply: LynxShipPlugin;
}

export function defineLynxShipPlugin(
  definition: LynxShipPluginDefinition,
): LynxShipPluginDefinition {
  if (definition.apiVersion !== LYNXSHIP_PLUGIN_API_VERSION)
    throw new Error(
      `Unsupported LynxShip plugin API version: ${String(definition.apiVersion)}`,
    );
  if (!definition.name.trim())
    throw new Error("A LynxShip plugin must have a non-empty name.");
  if (typeof definition.apply !== "function")
    throw new Error("A LynxShip plugin must expose an apply function.");
  const capabilities = new Set([
    "config",
    "build",
    "native",
    "autolink",
    "template",
    "cloud",
  ]);
  if (
    !Array.isArray(definition.capabilities) ||
    definition.capabilities.some((capability) => !capabilities.has(capability))
  )
    throw new Error("A LynxShip plugin must declare known capabilities.");
  if (!Array.isArray(definition.permissions))
    throw new Error("A LynxShip plugin must declare permissions.");
  const permissions = new Set([
    "config:write",
    "build:metadata",
    "native:write",
    "autolink:metadata",
    "template:register",
    "cloud:provider",
  ]);
  if (definition.permissions.some((permission) => !permissions.has(permission)))
    throw new Error("A LynxShip plugin must declare known permissions.");
  return definition;
}
