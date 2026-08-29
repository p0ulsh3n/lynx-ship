export type IntlCapability =
  | "PluralRules"
  | "NumberFormat"
  | "DateTimeFormat"
  | "RelativeTimeFormat"
  | "ListFormat"
  | "DisplayNames"
  | "Locale"
  | "getCanonicalLocales"
  | "Segmenter"
  | "DurationFormat";

export type IntlCapabilityState = Readonly<Record<IntlCapability, boolean>>;

export interface IntlRuntimeLike {
  readonly PluralRules?: unknown;
  readonly NumberFormat?: unknown;
  readonly DateTimeFormat?: unknown;
  readonly RelativeTimeFormat?: unknown;
  readonly ListFormat?: unknown;
  readonly DisplayNames?: unknown;
  readonly Locale?: unknown;
  readonly getCanonicalLocales?: unknown;
  readonly Segmenter?: unknown;
  readonly DurationFormat?: unknown;
}

export interface IntlPolyfillPlan {
  readonly capability: IntlCapability;
  readonly packageName: string;
  readonly setupEntryPoint: string;
  readonly localeDataEntryPoint: string;
}

const CAPABILITIES: readonly IntlCapability[] = [
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
];

const POLYFILLS: Readonly<Record<IntlCapability, IntlPolyfillPlan>> = {
  PluralRules: {
    capability: "PluralRules",
    packageName: "@formatjs/intl-pluralrules",
    setupEntryPoint: "@formatjs/intl-pluralrules/polyfill-force.js",
    localeDataEntryPoint: "@formatjs/intl-pluralrules/locale-data/{locale}.js",
  },
  NumberFormat: {
    capability: "NumberFormat",
    packageName: "@formatjs/intl-numberformat",
    setupEntryPoint: "@formatjs/intl-numberformat/polyfill-force.js",
    localeDataEntryPoint: "@formatjs/intl-numberformat/locale-data/{locale}.js",
  },
  DateTimeFormat: {
    capability: "DateTimeFormat",
    packageName: "@formatjs/intl-datetimeformat",
    setupEntryPoint: "@formatjs/intl-datetimeformat/polyfill-force.js",
    localeDataEntryPoint:
      "@formatjs/intl-datetimeformat/locale-data/{locale}.js",
  },
  RelativeTimeFormat: {
    capability: "RelativeTimeFormat",
    packageName: "@formatjs/intl-relativetimeformat",
    setupEntryPoint: "@formatjs/intl-relativetimeformat/polyfill-force.js",
    localeDataEntryPoint:
      "@formatjs/intl-relativetimeformat/locale-data/{locale}.js",
  },
  ListFormat: {
    capability: "ListFormat",
    packageName: "@formatjs/intl-listformat",
    setupEntryPoint: "@formatjs/intl-listformat/polyfill-force.js",
    localeDataEntryPoint: "@formatjs/intl-listformat/locale-data/{locale}.js",
  },
  DisplayNames: {
    capability: "DisplayNames",
    packageName: "@formatjs/intl-displaynames",
    setupEntryPoint: "@formatjs/intl-displaynames/polyfill-force.js",
    localeDataEntryPoint: "@formatjs/intl-displaynames/locale-data/{locale}.js",
  },
  Locale: {
    capability: "Locale",
    packageName: "@formatjs/intl-locale",
    setupEntryPoint: "@formatjs/intl-locale/polyfill-force.js",
    localeDataEntryPoint: "",
  },
  getCanonicalLocales: {
    capability: "getCanonicalLocales",
    packageName: "@formatjs/intl-getcanonicallocales",
    setupEntryPoint: "@formatjs/intl-getcanonicallocales/polyfill-force.js",
    localeDataEntryPoint: "",
  },
  Segmenter: {
    capability: "Segmenter",
    packageName: "@formatjs/intl-segmenter",
    setupEntryPoint: "@formatjs/intl-segmenter/polyfill-force.js",
    localeDataEntryPoint: "@formatjs/intl-segmenter/locale-data/{locale}.js",
  },
  DurationFormat: {
    capability: "DurationFormat",
    packageName: "@formatjs/intl-durationformat",
    setupEntryPoint: "@formatjs/intl-durationformat/polyfill-force.js",
    localeDataEntryPoint:
      "@formatjs/intl-durationformat/locale-data/{locale}.js",
  },
};

function runtimeIntl(): IntlRuntimeLike {
  const candidate = (globalThis as { Intl?: unknown }).Intl;
  return candidate && typeof candidate === "object"
    ? (candidate as IntlRuntimeLike)
    : {};
}

export function detectIntlCapabilities(
  runtime: IntlRuntimeLike = runtimeIntl(),
): IntlCapabilityState {
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [
      capability,
      typeof runtime[capability] === "function",
    ]),
  ) as IntlCapabilityState;
}

export function missingIntlCapabilities(
  required: readonly IntlCapability[],
  runtime: IntlRuntimeLike = runtimeIntl(),
): IntlCapability[] {
  const available = detectIntlCapabilities(runtime);
  return required.filter((capability) => !available[capability]);
}

export function planIntlPolyfills(
  required: readonly IntlCapability[],
  runtime: IntlRuntimeLike = runtimeIntl(),
): IntlPolyfillPlan[] {
  return missingIntlCapabilities(required, runtime).map(
    (capability) => POLYFILLS[capability],
  );
}

export function intlPolyfillPlan(capability: IntlCapability): IntlPolyfillPlan {
  return POLYFILLS[capability];
}
