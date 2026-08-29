import type { Platform } from "@lynxship/contracts";
import {
  type AutolinkContribution,
  type BuildContribution,
  type CloudIntegrationContribution,
  type JsonObject,
  type PluginContext,
  type PluginPlanChange,
  type TemplateContribution,
} from "@lynxship/plugin-api";
import type { LynxShipConfig } from "../config.js";
import {
  appliesToPlatform,
  mergeJson,
  pluginReference,
  pluginReferences,
  resolvePlugin,
} from "./discovery.js";
import type { PluginApplication, PluginReport } from "./contracts.js";
import type { ResolvedPlugin } from "./discovery.js";
import {
  applyNativeOperationsAtomically,
  assertNativeConflicts,
  assertPluginContribution,
  assertPluginPermissions,
  inspectNativeOperation,
  type OwnedNativeOperation,
} from "./native-operations.js";

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
