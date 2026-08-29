import type {
  AutolinkContribution,
  BuildContribution,
  CloudIntegrationContribution,
  PluginCapability,
  PluginPermission,
  PluginPlanChange,
  TemplateContribution,
} from "@lynxship/plugin-api";
import type { LynxShipConfig } from "../config.js";

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
