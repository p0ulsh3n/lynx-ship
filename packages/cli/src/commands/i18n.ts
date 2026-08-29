import type { IntlCapability } from "@lynxship/i18n";
import { assert } from "@lynxship/contracts";
import { setupI18n } from "../i18n/setup.js";
import type { BoxRow, CliUi } from "../ui/index.js";

export interface I18nCommandContext {
  root: string;
  args: string[];
  ui: CliUi;
  flag: (name: string, fallback?: string | null) => string | null;
  printValue: (
    value: unknown,
    view?: {
      title: string;
      rows: BoxRow[];
      done: string;
    },
  ) => void;
}

export async function runI18nCommand(
  context: I18nCommandContext,
): Promise<void> {
  const subcommand = context.args.shift() ?? "setup";
  assert(
    subcommand === "setup",
    "CLI_I18N_COMMAND",
    "Use `lynxship i18n setup`.",
  );
  const capabilities = parseCapabilities(context.flag("--intl"));
  const locales = parseList(context.flag("--locales"));
  const result = await setupI18n({
    root: context.root,
    entry: context.flag("--entry") ?? undefined,
    capabilities,
    locales,
    persistence: !context.args.includes("--no-persistence"),
    dryRun: context.args.includes("--dry-run"),
    onOutput: (line) => context.ui.debug(line),
  });
  context.printValue(result, {
    title: `LynxShip i18n · ${result.status}`,
    rows: [
      { label: "Entry", value: result.entryFile, valueColor: "muted" },
      {
        label: "Locales",
        value: result.locales.join(", "),
        valueColor: "blue",
      },
      {
        label: "Intl",
        value: result.capabilities.join(", "),
        valueColor: "purple",
      },
      {
        label: "Dependencies",
        value: result.packages.length
          ? result.packages.join(", ")
          : "already installed",
        valueColor: result.packages.length ? "yellow" : "green",
      },
      {
        label: "Persistence",
        value: result.persistence
          ? "automatic when host storage is linked"
          : "disabled",
        valueColor: result.persistence ? "green" : "muted",
      },
    ],
    done:
      result.status === "planned"
        ? "Dry run complete; no dependency or source file was changed."
        : "i18n setup is idempotent; rebuild the Lynx bundle after dependency installation.",
  });
}

function parseList(value: string | null): string[] | undefined {
  if (!value || value === "auto") return undefined;
  if (value === "all")
    return [
      "PluralRules",
      "NumberFormat",
      "DateTimeFormat",
      "RelativeTimeFormat",
      "ListFormat",
      "DisplayNames",
      "Segmenter",
      "DurationFormat",
    ];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCapabilities(value: string | null): IntlCapability[] | undefined {
  const values = parseList(value);
  if (!values) return undefined;
  const allowed = new Set<IntlCapability>([
    "PluralRules",
    "NumberFormat",
    "DateTimeFormat",
    "RelativeTimeFormat",
    "ListFormat",
    "DisplayNames",
    "Locale",
    "getCanonicalLocales",
    "Segmenter",
    "DurationFormat",
  ]);
  assert(
    values.every((item) => allowed.has(item as IntlCapability)),
    "CLI_I18N_CAPABILITY",
    `Unknown Intl capability. Use one of: ${[...allowed].join(", ")}`,
  );
  return values as IntlCapability[];
}
