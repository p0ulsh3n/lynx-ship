import {
  LYNXSHIP_PLUGIN_API_VERSION,
  type LynxShipPluginDefinition,
  type PluginCapability,
  type PluginPermission,
} from "@lynxship/plugin-api";

export { LYNXSHIP_PLUGIN_API_VERSION };

export const KNOWN_CAPABILITIES: readonly PluginCapability[] = [
  "config",
  "build",
  "native",
  "autolink",
  "template",
  "cloud",
];

export const KNOWN_PERMISSIONS: readonly PluginPermission[] = [
  "config:write",
  "build:metadata",
  "native:write",
  "autolink:metadata",
  "template:register",
  "cloud:provider",
];

export function capabilities(value: unknown): PluginCapability[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is PluginCapability =>
    KNOWN_CAPABILITIES.includes(candidate as PluginCapability),
  );
}

export function permissions(value: unknown): PluginPermission[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is PluginPermission =>
    KNOWN_PERMISSIONS.includes(candidate as PluginPermission),
  );
}

export function isKnownList(
  value: unknown,
  allowed: readonly string[],
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (candidate) =>
        typeof candidate === "string" && allowed.includes(candidate),
    )
  );
}

export function validPluginDefinition(
  value: unknown,
): value is LynxShipPluginDefinition {
  if (!value || typeof value !== "object") return false;
  const definition = value as Partial<LynxShipPluginDefinition>;
  return (
    definition.apiVersion === LYNXSHIP_PLUGIN_API_VERSION &&
    typeof definition.name === "string" &&
    definition.name.length > 0 &&
    isKnownList(definition.capabilities, KNOWN_CAPABILITIES) &&
    isKnownList(definition.permissions, KNOWN_PERMISSIONS) &&
    (definition.platforms === undefined ||
      isKnownList(definition.platforms, [
        "all",
        "android",
        "ios",
        "harmonyos",
        "web",
        "desktop",
      ])) &&
    typeof definition.apply === "function"
  );
}
