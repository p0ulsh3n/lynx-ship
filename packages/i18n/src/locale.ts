import type { PluralCategory } from "./contracts.js";

const RTL_LANGUAGES = new Set([
  "ar",
  "dv",
  "fa",
  "he",
  "ku",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
]);

export function normalizeLocale(locale: string): string {
  const parts = locale.trim().replace(/_/g, "-").split("-").filter(Boolean);
  const [language = "en", ...rest] = parts;
  return [
    language.toLowerCase(),
    ...rest.map((part) =>
      /^[A-Za-z]{4}$/.test(part)
        ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`
        : /^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)
          ? part.toUpperCase()
          : part.toLowerCase(),
    ),
  ].join("-");
}

function localeCandidates(locale: string): string[] {
  const normalized = normalizeLocale(locale);
  const parts = normalized.split("-");
  const language = parts[0] ?? normalized;
  const script = parts.find((part) => /^[A-Z][a-z]{3}$/.test(part));
  const region = parts.find(
    (part) => /^[A-Z]{2}$/.test(part) || /^\d{3}$/.test(part),
  );
  return [
    ...new Set(
      [
        normalized,
        script && region ? `${language}-${script}-${region}` : "",
        script ? `${language}-${script}` : "",
        region ? `${language}-${region}` : "",
        language,
      ].filter(Boolean),
    ),
  ];
}

function findAvailable(
  requested: string,
  available: readonly string[],
): string | undefined {
  for (const candidate of localeCandidates(requested)) {
    const match = available.find(
      (locale) => normalizeLocale(locale) === candidate,
    );
    if (match) return match;
  }
  const language = normalizeLocale(requested).split("-")[0] ?? "en";
  return available.find(
    (locale) => normalizeLocale(locale).split("-")[0] === language,
  );
}

export function resolveLocale(
  requested: string,
  available: readonly string[],
  fallback: string,
): string {
  return (
    findAvailable(requested, available) ??
    findAvailable(fallback, available) ??
    normalizeLocale(fallback)
  );
}

export function isRtlLocale(locale: string): boolean {
  return RTL_LANGUAGES.has(normalizeLocale(locale).split("-")[0] ?? "");
}

export function defaultPluralCategory(
  locale: string,
  count: number,
): PluralCategory {
  const IntlConstructor = (
    globalThis as typeof globalThis & {
      Intl?: typeof Intl;
    }
  ).Intl;
  if (IntlConstructor?.PluralRules) {
    try {
      return new IntlConstructor.PluralRules(normalizeLocale(locale)).select(
        count,
      ) as PluralCategory;
    } catch {
      // Lynx runtimes may expose a partial Intl implementation.
    }
  }

  const language = normalizeLocale(locale).split("-")[0] ?? "en";
  const integer = Number.isInteger(count);
  const absolute = Math.abs(count);
  const mod10 = absolute % 10;
  const mod100 = absolute % 100;

  if (language === "ar" && integer) {
    if (absolute === 0) return "zero";
    if (absolute === 1) return "one";
    if (absolute === 2) return "two";
    if (mod100 >= 3 && mod100 <= 10) return "few";
    if (mod100 >= 11 && mod100 <= 99) return "many";
  }
  if (["ru", "uk", "be"].includes(language) && integer) {
    if (mod10 === 1 && mod100 !== 11) return "one";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
    if (mod10 === 0 || mod10 >= 5 || (mod100 >= 11 && mod100 <= 14))
      return "many";
  }
  if (language === "pl" && integer) {
    if (absolute === 1) return "one";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
    return "many";
  }
  if (["cs", "sk"].includes(language) && integer) {
    if (absolute === 1) return "one";
    if (absolute >= 2 && absolute <= 4) return "few";
  }
  if (["fr", "pt"].includes(language))
    return absolute >= 0 && absolute < 2 ? "one" : "other";
  if (language === "ro") {
    if (absolute === 1) return "one";
    if (absolute === 0 || (mod100 >= 1 && mod100 <= 19)) return "few";
  }
  if (language === "sl" && integer) {
    if (mod100 === 1) return "one";
    if (mod100 === 2) return "two";
    if (mod100 === 3 || mod100 === 4) return "few";
  }
  if (language === "lt" && integer) {
    if (mod10 === 1 && (mod100 < 11 || mod100 > 19)) return "one";
    if (mod10 >= 2 && mod10 <= 9 && (mod100 < 11 || mod100 > 19)) return "few";
    if (mod100 >= 11 && mod100 <= 19) return "many";
  }
  return absolute === 1 ? "one" : "other";
}
