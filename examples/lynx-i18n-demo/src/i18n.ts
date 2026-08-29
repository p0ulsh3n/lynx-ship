import "@formatjs/intl-pluralrules/polyfill-force.js";
import "@formatjs/intl-pluralrules/locale-data/ar.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/fr.js";
import {
  createLynxI18next,
  loadLynxI18nextCustomSection,
} from "@lynxship/i18n/i18next";
import type { Resource } from "i18next";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

const staticResources: Resource = {
  en: { translation: en },
  fr: { translation: fr },
  ar: { translation: ar },
};

function loadResources(): Resource {
  const runtime = globalThis as typeof globalThis & {
    lynx?: { getCustomSectionSync?: unknown };
  };
  return typeof runtime.lynx?.getCustomSectionSync === "function"
    ? loadLynxI18nextCustomSection()
    : staticResources;
}

export const i18n = createLynxI18next({
  defaultLocale: "en",
  fallbackLocale: "en",
  supportedLocales: ["en", "fr", "ar"],
  resources: loadResources(),
  initOptions: {
    ns: ["translation"],
    defaultNS: "translation",
  },
});
