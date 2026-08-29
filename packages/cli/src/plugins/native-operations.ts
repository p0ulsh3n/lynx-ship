import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Platform } from "@lynxship/contracts";
import {
  type BuildContribution,
  type CloudIntegrationContribution,
  type JsonObject,
  type LynxShipPluginDefinition,
  type NativeFileOperation,
  type PluginCapability,
  type AutolinkContribution,
  type PluginPermission,
  type PluginPlanChange,
  type TemplateContribution,
} from "@lynxship/plugin-api";
import { appliesToPlatform, mergeJson, safeProjectFile } from "./discovery.js";

export interface OwnedNativeOperation {
  plugin: string;
  operation: NativeFileOperation;
}

function permissionForContribution(contribution: {
  config?: JsonObject;
  build?: BuildContribution;
  native?: readonly NativeFileOperation[];
  autolink?: AutolinkContribution;
  templates?: readonly TemplateContribution[];
  cloud?: readonly CloudIntegrationContribution[];
}): PluginPermission[] {
  const required: PluginPermission[] = [];
  if (contribution.config) required.push("config:write");
  if (contribution.build) required.push("build:metadata");
  if (contribution.native?.length) required.push("native:write");
  if (contribution.autolink) required.push("autolink:metadata");
  if (contribution.templates?.length) required.push("template:register");
  if (contribution.cloud?.length) required.push("cloud:provider");
  return required;
}

function capabilityForPermission(
  permission: PluginPermission,
): PluginCapability {
  return permission.split(":")[0] as PluginCapability;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function assertPluginContribution(
  plugin: LynxShipPluginDefinition,
  contribution: unknown,
): asserts contribution is {
  config?: JsonObject;
  build?: BuildContribution;
  native?: readonly NativeFileOperation[];
  autolink?: AutolinkContribution;
  templates?: readonly TemplateContribution[];
  cloud?: readonly CloudIntegrationContribution[];
} {
  if (!isJsonObject(contribution))
    throw new Error(
      `Plugin '${plugin.name}' returned an invalid contribution object`,
    );
  if (contribution.config !== undefined && !isJsonObject(contribution.config))
    throw new Error(
      `Plugin '${plugin.name}' returned an invalid config contribution`,
    );
  if (contribution.native !== undefined && !Array.isArray(contribution.native))
    throw new Error(
      `Plugin '${plugin.name}' returned an invalid native contribution`,
    );
  for (const operation of contribution.native ?? []) {
    if (!isJsonObject(operation))
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid native operation`,
      );
    if (
      !["all", "android", "ios", "harmonyos", "web", "desktop"].includes(
        String(operation.platform),
      ) ||
      typeof operation.file !== "string" ||
      operation.file.length === 0 ||
      !["ensure-text", "append-text", "replace-text", "json-merge"].includes(
        String(operation.operation),
      )
    )
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid native operation`,
      );
    if (
      (operation.operation === "ensure-text" ||
        operation.operation === "append-text") &&
      typeof operation.text !== "string"
    )
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid text operation`,
      );
    if (
      operation.operation === "replace-text" &&
      (typeof operation.from !== "string" || typeof operation.to !== "string")
    )
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid replacement operation`,
      );
    if (operation.operation === "json-merge" && !isJsonObject(operation.value))
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid JSON merge operation`,
      );
  }
  if (contribution.autolink !== undefined) {
    if (!isJsonObject(contribution.autolink))
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid Autolink contribution`,
      );
    for (const key of ["packageNames", "capabilities"] as const) {
      const value = contribution.autolink[key];
      if (
        value !== undefined &&
        (!Array.isArray(value) ||
          !value.every((item) => typeof item === "string"))
      )
        throw new Error(
          `Plugin '${plugin.name}' returned invalid Autolink metadata`,
        );
    }
  }
  if (contribution.build !== undefined) {
    if (!isJsonObject(contribution.build))
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid build contribution`,
      );
    for (const key of [
      "requiredTools",
      "artifactExtensions",
      "notes",
    ] as const) {
      const value = contribution.build[key];
      if (
        value !== undefined &&
        (!Array.isArray(value) ||
          !value.every((item) => typeof item === "string"))
      )
        throw new Error(
          `Plugin '${plugin.name}' returned invalid build metadata`,
        );
    }
  }
  for (const template of Array.isArray(contribution.templates)
    ? contribution.templates
    : []) {
    if (
      !isJsonObject(template) ||
      typeof template.id !== "string" ||
      typeof template.displayName !== "string" ||
      typeof template.source !== "string"
    )
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid template contribution`,
      );
  }
  for (const integration of Array.isArray(contribution.cloud)
    ? contribution.cloud
    : []) {
    if (
      !isJsonObject(integration) ||
      typeof integration.id !== "string" ||
      typeof integration.displayName !== "string" ||
      !Array.isArray(integration.capabilities) ||
      !integration.capabilities.every((item) =>
        ["build", "artifacts", "updates", "submit"].includes(String(item)),
      )
    )
      throw new Error(
        `Plugin '${plugin.name}' returned an invalid cloud contribution`,
      );
  }
}

export function assertPluginPermissions(
  plugin: LynxShipPluginDefinition,
  contribution: Parameters<typeof permissionForContribution>[0],
): void {
  const missing = permissionForContribution(contribution).filter(
    (permission) => !plugin.permissions.includes(permission),
  );
  const missingCapabilities = permissionForContribution(contribution)
    .map(capabilityForPermission)
    .filter((capability) => !plugin.capabilities.includes(capability));
  if (missing.length)
    throw new Error(
      `Plugin '${plugin.name}' returned contributions without declaring permission(s): ${missing.join(", ")}`,
    );
  if (missingCapabilities.length)
    throw new Error(
      `Plugin '${plugin.name}' returned contributions without declaring capability(ies): ${[...new Set(missingCapabilities)].join(", ")}`,
    );
}

async function mergeJsonFile(file: string, value: JsonObject): Promise<void> {
  const current = JSON.parse(await readFile(file, "utf8")) as JsonObject;
  await writeFile(
    file,
    `${JSON.stringify(mergeJson(current, value), null, 2)}\n`,
  );
}

export async function inspectNativeOperation(
  root: string,
  owned: OwnedNativeOperation,
  platform: Platform,
): Promise<PluginPlanChange | undefined> {
  const operation = owned.operation;
  if (!appliesToPlatform([operation.platform], platform)) return undefined;
  const file = safeProjectFile(root, operation.file);
  const current = existsSync(file) ? await readFile(file, "utf8") : "";
  let changed = false;
  if (operation.operation === "json-merge") {
    if (!existsSync(file))
      throw new Error(`Plugin JSON target does not exist: ${operation.file}`);
    const merged = `${JSON.stringify(
      mergeJson(JSON.parse(current) as JsonObject, operation.value),
      null,
      2,
    )}\n`;
    changed = merged !== current;
  } else if (operation.operation === "ensure-text") {
    changed = !current.includes(operation.text);
  } else if (operation.operation === "append-text") {
    changed = !current.includes(operation.text);
  } else if (operation.operation === "replace-text") {
    if (!current.includes(operation.from))
      throw new Error(
        `Plugin replacement target was not found in ${operation.file}`,
      );
    changed = current.replace(operation.from, operation.to) !== current;
  }
  return {
    plugin: owned.plugin,
    platform,
    file: operation.file,
    operation: operation.operation,
    changed,
  };
}

async function applyNativeOperation(
  root: string,
  operation: NativeFileOperation,
  platform: Platform,
): Promise<void> {
  if (!appliesToPlatform([operation.platform], platform)) return;
  const file = safeProjectFile(root, operation.file);
  await mkdir(dirname(file), { recursive: true });
  if (operation.operation === "json-merge") {
    if (!existsSync(file))
      throw new Error(`Plugin JSON target does not exist: ${operation.file}`);
    await mergeJsonFile(file, operation.value);
    return;
  }
  const current = existsSync(file) ? await readFile(file, "utf8") : "";
  if (operation.operation === "ensure-text") {
    if (!current.includes(operation.text))
      await writeFile(
        file,
        `${current}${current && !current.endsWith("\n") ? "\n" : ""}${operation.text}\n`,
      );
    return;
  }
  if (operation.operation === "append-text") {
    if (current.includes(operation.text)) return;
    await writeFile(
      file,
      `${current}${current && !current.endsWith("\n") ? "\n" : ""}${operation.text}\n`,
    );
    return;
  }
  if (operation.operation !== "replace-text") return;
  if (!current.includes(operation.from))
    throw new Error(
      `Plugin replacement target was not found in ${operation.file}`,
    );
  await writeFile(file, current.replace(operation.from, operation.to));
}

export function assertNativeConflicts(
  root: string,
  operations: readonly OwnedNativeOperation[],
): void {
  const seen = new Map<string, OwnedNativeOperation>();
  for (const owned of operations) {
    const file = safeProjectFile(root, owned.operation.file);
    const previous = seen.get(file);
    if (!previous) {
      seen.set(file, owned);
      continue;
    }
    const currentOperation = owned.operation;
    const previousOperation = previous.operation;
    if (
      currentOperation.operation === "replace-text" &&
      previousOperation.operation === "replace-text" &&
      currentOperation.from === previousOperation.from
    )
      throw new Error(
        `Conflicting or duplicate LynxShip plugins '${previous.plugin}' and '${owned.plugin}' both replace '${currentOperation.from}' in ${currentOperation.file}`,
      );
  }
}

export async function applyNativeOperationsAtomically(
  root: string,
  operations: readonly OwnedNativeOperation[],
  platform: Platform,
): Promise<PluginPlanChange[]> {
  assertNativeConflicts(root, operations);
  const backups = new Map<string, string | undefined>();
  for (const owned of operations) {
    if (!appliesToPlatform([owned.operation.platform], platform)) continue;
    const file = safeProjectFile(root, owned.operation.file);
    if (!backups.has(file))
      backups.set(
        file,
        existsSync(file) ? await readFile(file, "utf8") : undefined,
      );
  }
  try {
    const changes = (
      await Promise.all(
        operations.map((operation) =>
          inspectNativeOperation(root, operation, platform),
        ),
      )
    ).filter((change): change is PluginPlanChange => Boolean(change));
    for (const owned of operations)
      await applyNativeOperation(root, owned.operation, platform);
    return changes;
  } catch (error) {
    for (const [file, content] of backups) {
      if (content === undefined) await rm(file, { force: true });
      else {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, content);
      }
    }
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; native plugin changes were rolled back`,
    );
  }
}
