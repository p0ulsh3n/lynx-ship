export type {
  PluginApplication,
  PluginReport,
  ProjectPluginInfo,
} from "./plugins/contracts.js";

export { inspectProjectPlugins } from "./plugins/discovery.js";

export { applyProjectPlugins } from "./plugins/operations.js";
