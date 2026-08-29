import assert from "node:assert/strict";
import test from "node:test";
import {
  createCachedResourceLoader,
  createLynxI18next,
  createLynxResourceBackend,
  createMemoryResourceCache,
  createStaticResourceLoader,
  loadLynxI18nextCustomSection,
} from "@lynxship/i18n/i18next";

test("loads the official Lynx i18next custom-section shape safely", () => {
  const calls: string[] = [];
  const resources = loadLynxI18nextCustomSection({
    getCustomSectionSync(key) {
      calls.push(key);
      return {
        en: { hello: "Hello" },
        fr: { hello: "Bonjour" },
        invalid: null,
      };
    },
  });

  assert.deepEqual(resources, {
    en: { translation: { hello: "Hello" } },
    fr: { translation: { hello: "Bonjour" } },
  });
  assert.deepEqual(calls, ["i18next-translations"]);
  assert.deepEqual(
    loadLynxI18nextCustomSection({ getCustomSectionSync: () => [] }),
    {},
  );
});

test("adapts isolated i18next instances and publishes lifecycle state", async () => {
  const adapter = createLynxI18next({
    defaultLocale: "en-US",
    fallbackLocale: "en",
    supportedLocales: ["en", "fr", "ar"],
    resources: {
      en: {
        common: {
          greeting: "Hello {{name}}",
          item_one: "{{count}} item",
          item_other: "{{count}} items",
        },
      },
      fr: { common: { greeting: "Bonjour {{name}}" } },
      ar: { common: { greeting: "مرحبا {{name}}" } },
    },
    initOptions: { ns: ["common"], defaultNS: "common" },
  });
  let notifications = 0;
  const unsubscribe = adapter.subscribe(() => notifications++);

  await adapter.init();
  assert.equal(adapter.snapshot().status, "ready");
  assert.equal(adapter.t("greeting", { name: "Lynx" }), "Hello Lynx");
  assert.equal(adapter.t("item", { count: 2 }), "2 items");
  assert.equal(adapter.hasLoadedNamespace("common"), true);

  await adapter.changeLanguage("ar");
  assert.equal(adapter.snapshot().direction, "rtl");
  assert.equal(adapter.t("greeting", { name: "Lynx" }), "مرحبا Lynx");
  assert.ok(notifications > 0);

  unsubscribe();
  const before = notifications;
  await adapter.changeLanguage("fr");
  assert.equal(notifications, before);
});

test("loads a missing namespace through the explicit Lynx backend", async () => {
  const adapter = createLynxI18next({
    defaultLocale: "en",
    fallbackLocale: "en",
    supportedLocales: ["en", "fr"],
    resources: { en: { common: { hello: "Hello" } } },
    plugins: [
      createLynxResourceBackend({
        loader: createStaticResourceLoader({
          en: { common: { hello: "Hello" }, account: { title: "Account" } },
          fr: { common: { hello: "Bonjour" }, account: { title: "Compte" } },
        }),
      }),
    ],
    initOptions: {
      ns: ["common"],
      defaultNS: "common",
      partialBundledLanguages: true,
    },
  });

  await adapter.init();
  assert.equal(adapter.hasLoadedNamespace("account"), false);
  await adapter.loadNamespaces("account");
  assert.equal(adapter.hasLoadedNamespace("account"), true);
  assert.equal(adapter.t("title", { ns: "account" }), "Account");
  await adapter.changeLanguage("fr");
  assert.equal(adapter.t("title", { ns: "account" }), "Compte");
});

test("deduplicates cached resource loads and invalidates expired entries", async () => {
  let now = 100;
  let loads = 0;
  const cache = createMemoryResourceCache();
  const loader = createCachedResourceLoader({
    cache,
    version: "bundle-1",
    ttlMs: 10,
    now: () => now,
    loader: {
      async load() {
        loads++;
        return { greeting: "Hello" };
      },
    },
  });

  const results = await Promise.all([
    loader.load("en", "common"),
    loader.load("en", "common"),
  ]);
  assert.deepEqual(results[0], { greeting: "Hello" });
  assert.deepEqual(results[1], { greeting: "Hello" });
  assert.equal(loads, 1);

  await loader.load("en", "common");
  assert.equal(loads, 1);
  now = 111;
  await loader.load("en", "common");
  assert.equal(loads, 2);
});

test("restores and persists the resolved locale through injected storage", async () => {
  const values = new Map([["settings.language", "fr-FR"]]);
  const adapter = createLynxI18next({
    defaultLocale: "en",
    fallbackLocale: "en",
    supportedLocales: ["en", "fr"],
    resources: {
      en: { translation: { greeting: "Hello" } },
      fr: { translation: { greeting: "Bonjour" } },
    },
    persistence: {
      key: "settings.language",
      storage: {
        get: async (key) => values.get(key),
        set: async (key, value) => {
          values.set(key, value);
        },
      },
    },
  });

  await adapter.init();
  assert.equal(adapter.snapshot().language, "fr");
  assert.equal(adapter.t("greeting"), "Bonjour");
  await adapter.changeLanguage("en");
  assert.equal(values.get("settings.language"), "en");

  await Promise.all([
    adapter.changeLanguage("fr"),
    adapter.changeLanguage("en"),
  ]);
  assert.equal(values.get("settings.language"), "en");
});
