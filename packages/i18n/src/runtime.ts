import type {
  I18n,
  I18nOptions,
  TranslationMap,
  TranslationValue,
} from "./contracts.js";
import { defaultPluralCategory, resolveLocale } from "./locale.js";

function lookup(
  map: TranslationMap,
  key: string,
): TranslationValue | undefined {
  return key
    .split(".")
    .reduce<
      TranslationValue | undefined
    >((current, part) => (current && typeof current !== "string" ? current[part] : undefined), map);
}

function interpolate(
  value: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) =>
    String(values[key] ?? `{{${key}}}`),
  );
}

export function createI18n(options: I18nOptions): I18n {
  const available = Object.keys(options.messages);
  let current = resolveLocale(
    options.locale,
    available,
    options.fallbackLocale,
  );
  const fallback = resolveLocale(
    options.fallbackLocale,
    available,
    options.fallbackLocale,
  );
  const pluralCategory = options.pluralCategory ?? defaultPluralCategory;
  const listeners = new Set<() => void>();
  const message = (
    locale: string,
    key: string,
    values: Readonly<Record<string, string | number>>,
  ): string | undefined => {
    const value = lookup(options.messages[locale] ?? {}, key);
    if (typeof value === "string") return interpolate(value, values);
    const count = values.count;
    if (typeof count === "number") {
      const plural = lookup(
        options.messages[locale] ?? {},
        `${key}_${pluralCategory(locale, count)}`,
      );
      if (typeof plural === "string") return interpolate(plural, values);
    }
    return undefined;
  };
  return {
    locale: () => current,
    setLocale: (locale) => {
      const next = resolveLocale(locale, available, fallback);
      if (next === current) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    t: (key, values = {}) =>
      message(current, key, values) ?? message(fallback, key, values) ?? key,
  };
}
