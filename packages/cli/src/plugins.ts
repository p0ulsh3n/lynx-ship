import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Platform } from "@lynxship/contracts";
import {
  LYNXSHIP_PLUGIN_API_VERSION,
  type BuildContribution,
  type CloudIntegrationContribution,
  type JsonObject,
  type JsonValue,
  type LynxShipPluginDefinition,
  type NativeFileOperation,
  type PluginCapability,
  type PluginContext,
  type AutolinkContribution,
  type PluginPermission,
  type PluginPlanChange,
  type PluginPlatform,
  type PluginReference,
  type TemplateContribution,
} from "@lynxship/plugin-api";
import type { LynxShipConfig } from "./config.js";

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

export interface ProjectPluginInfo {
  name: string;
  version?: string;
  packagePath?: string;
  entry?: string;
  apiVersion?: number;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  status: "ready" | "missing" | "invalid";
  reason: string;
}

export interface PluginReport {
  configured: number;
  plugins: ProjectPluginInfo[];
}

export interface PluginApplication {
  config: LynxShipConfig;
  report: PluginReport;
  applied: string[];
  templates: TemplateContribution[];
  cloud: CloudIntegrationContribution[];
  build: BuildContribution[];
  changes: PluginPlanChange[];
  autolink: AutolinkContribution[];
}

interface ResolvedPlugin {
  info: ProjectPluginInfo;
  definition?: LynxShipPluginDefinition;
}

function pluginReference(reference: PluginReference): {
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

function capabilities(value: unknown): PluginCapability[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is PluginCapability =>
    ["config", "build", "native", "autolink", "template", "cloud"].includes(
      candidate as string,
    ),
  );
}

const KNOWN_CAPABILITIES: readonly PluginCapability[] = [
  "config",
  "build",
  "native",
  "autolink",
  "template",
  "cloud",
];

const KNOWN_PERMISSIONS: readonly PluginPermission[] = [
  "config:write",
  "build:metadata",
  "native:write",
  "autolink:metadata",
  "template:register",
  "cloud:provider",
];

function isKnownList(
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

function permissions(value: unknown): PluginPermission[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is PluginPermission =>
    [
      "config:write",
      "build:metadata",
      "native:write",
      "autolink:metadata",
      "template:register",
      "cloud:provider",
    ].includes(candidate as string),
  );
}

function validPluginDefinition(
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

async function resolvePlugin(
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

function pluginReferences(config: LynxShipConfig): PluginReference[] {
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

function appliesToPlatform(
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

function mergeJson(left: JsonObject, right: JsonObject): JsonObject {
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

function safeProjectFile(root: string, file: string): string {
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

interface OwnedNativeOperation {
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

function assertPluginContribution(
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

function assertPluginPermissions(
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

async function inspectNativeOperation(
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

function assertNativeConflicts(
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

async function applyNativeOperationsAtomically(
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

export async function applyProjectPlugins(
  root: string,
  config: LynxShipConfig,
  target: { platform: Platform; profile: string; mode?: "plan" | "apply" },
): Promise<PluginApplication> {
  const references = pluginReferences(config);
  const resolved: ResolvedPlugin[] = [];
  for (const reference of references)
    resolved.push(await resolvePlugin(root, reference));
  const report: PluginReport = {
    configured: references.length,
    plugins: resolved.map((plugin) => plugin.info),
  };
  const invalid = report.plugins.find((plugin) => plugin.status !== "ready");
  if (invalid)
    throw new Error(
      `LynxShip plugin '${invalid.name}' is invalid: ${invalid.reason}`,
    );

  let effectiveConfig = JSON.parse(JSON.stringify(config)) as LynxShipConfig;
  const applied: string[] = [];
  const templates: TemplateContribution[] = [];
  const cloud: CloudIntegrationContribution[] = [];
  const build: BuildContribution[] = [];
  const autolink: AutolinkContribution[] = [];
  const operations: OwnedNativeOperation[] = [];
  for (let index = 0; index < resolved.length; index += 1) {
    const plugin = resolved[index];
    const reference = references[index];
    if (!plugin?.definition || !reference) continue;
    if (!appliesToPlatform(plugin.definition.platforms, target.platform))
      continue;
    const options = pluginReference(reference).options;
    const context: PluginContext = {
      rootDir: root,
      platform: target.platform,
      profile: target.profile,
      mode: target.mode ?? "apply",
      projectId: config.projectId,
      config: effectiveConfig as unknown as JsonObject,
      options,
    };
    const contribution = await plugin.definition.apply(context);
    if (!contribution) {
      applied.push(plugin.info.name);
      continue;
    }
    assertPluginContribution(plugin.definition, contribution);
    assertPluginPermissions(plugin.definition, contribution);
    if (contribution.config)
      effectiveConfig = mergeJson(
        effectiveConfig as unknown as JsonObject,
        contribution.config,
      ) as unknown as LynxShipConfig;
    for (const operation of contribution.native ?? [])
      operations.push({ plugin: plugin.info.name, operation });
    if (contribution.autolink) autolink.push(contribution.autolink);
    templates.push(...(contribution.templates ?? []));
    cloud.push(...(contribution.cloud ?? []));
    if (contribution.build) build.push(contribution.build);
    applied.push(plugin.info.name);
  }
  let changes: PluginPlanChange[];
  if (target.mode === "plan") {
    assertNativeConflicts(root, operations);
    changes = (
      await Promise.all(
        operations.map((operation) =>
          inspectNativeOperation(root, operation, target.platform),
        ),
      )
    ).filter((change): change is PluginPlanChange => Boolean(change));
  } else {
    changes = await applyNativeOperationsAtomically(
      root,
      operations,
      target.platform,
    );
  }
  return {
    config: effectiveConfig,
    report,
    applied,
    templates,
    cloud,
    build,
    autolink,
    changes,
  };
}
