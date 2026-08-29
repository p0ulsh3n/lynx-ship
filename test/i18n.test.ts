import test from "node:test";
import assert from "node:assert/strict";
import {
  createI18n,
  defaultPluralCategory,
  isRtlLocale,
  normalizeLocale,
  resolveLocale,
} from "@lynxship/i18n";

test("resolves locale, interpolation, plural fallback, and RTL without global state", () => {
  assert.equal(resolveLocale("fr_CA", ["en", "fr-FR"], "en"), "fr-FR");
  assert.equal(isRtlLocale("ar-EG"), true);
  const i18n = createI18n({
    locale: "en-US",
    fallbackLocale: "fr",
    messages: {
      en: {
        hello: "Hello {{name}}",
        item_one: "{{count}} item",
        item_other: "{{count}} items",
      },
      fr: { hello: "Bonjour {{name}}" },
    },
  });
  assert.equal(i18n.t("hello", { name: "Lynx" }), "Hello Lynx");
  assert.equal(i18n.t("item", { count: 2 }), "2 items");
  i18n.setLocale("fr-CA");
  assert.equal(i18n.t("hello", { name: "Lynx" }), "Bonjour Lynx");
});

test("uses BCP-47 fallback chains and notifies locale subscribers", () => {
  assert.equal(normalizeLocale("zh_hant_tw"), "zh-Hant-TW");
  assert.equal(
    resolveLocale("zh-Hant-TW", ["en", "zh-Hant"], "fr-CA"),
    "zh-Hant",
  );
  assert.equal(resolveLocale("de-DE", ["en", "fr"], "fr-CA"), "fr");

  const i18n = createI18n({
    locale: "en",
    fallbackLocale: "en",
    messages: { en: { hello: "Hello" }, fr: { hello: "Bonjour" } },
  });
  let changes = 0;
  const unsubscribe = i18n.subscribe(() => changes++);
  i18n.setLocale("fr");
  i18n.setLocale("fr-CA");
  assert.equal(changes, 1);
  assert.equal(i18n.t("hello"), "Bonjour");
  unsubscribe();
  i18n.setLocale("en");
  assert.equal(changes, 1);
});

test("supports plural categories needed outside English and French", () => {
  assert.equal(defaultPluralCategory("ar", 0), "zero");
  assert.equal(defaultPluralCategory("ar", 2), "two");
  assert.equal(defaultPluralCategory("ru", 22), "few");
  assert.equal(defaultPluralCategory("pl", 12), "many");
  assert.equal(defaultPluralCategory("sl", 2), "two");
});
