export const CREATE_APP_VERSION = "0.1.4";

export const RSPEEDY_VERSION = "latest";

export const LYNXSHIP_CLI_VERSION = "latest";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type CreateAppTemplate = "react-ts" | "react-js" | "vue-ts" | "vue-js";

export interface CreateAppOptions {
  readonly projectName?: string;
  readonly directory?: string;
  readonly template: CreateAppTemplate;
  readonly install: boolean;
  readonly git: boolean;
}

export interface CreateAppResult {
  readonly directory: string;
  readonly projectId: string;
  readonly packageManager: PackageManager;
  readonly installed: boolean;
}
