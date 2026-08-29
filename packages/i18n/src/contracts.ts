export type TranslationValue = string | TranslationMap;

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export type PluralCategoryResolver = (
  locale: string,
  count: number,
) => PluralCategory;

export interface TranslationMap {
  readonly [key: string]: TranslationValue;
}

export interface I18nOptions {
  locale: string;
  fallbackLocale: string;
  messages: Readonly<Record<string, TranslationMap>>;
  pluralCategory?: PluralCategoryResolver;
}

export interface I18n {
  locale(): string;
  setLocale(locale: string): void;
  subscribe(listener: () => void): () => void;
  t(key: string, values?: Readonly<Record<string, string | number>>): string;
}
