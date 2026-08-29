import type { IntlCapability } from "@lynxship/i18n";

export interface I18nSetupPlan {
  readonly entryFile: string;
  readonly polyfillFile: string;
  readonly locales: readonly string[];
  readonly capabilities: readonly IntlCapability[];
  readonly packages: readonly string[];
  readonly persistence: boolean;
  readonly entryAlreadyPatched: boolean;
  readonly polyfillAlreadyGenerated: boolean;
}

export interface I18nSetupResult extends I18nSetupPlan {
  readonly status: "planned" | "applied";
  readonly installed: readonly string[];
  readonly filesChanged: readonly string[];
}
