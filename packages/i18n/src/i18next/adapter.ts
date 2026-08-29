import { createInstance, type i18n as I18nextInstance } from "i18next";
import type {
  I18nextInitOptions,
  LynxI18nextAdapter,
  LynxI18nextOptions,
  LynxI18nextSnapshot,
  LocalePersistenceOptions,
} from "./contracts.js";
import { createLynxLocaleStorage } from "./storage.js";
import { DEFAULT_LOCALE_KEY } from "./storage.js";
import { normalizeLocale } from "../locale.js";

function normalizeList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createLynxI18next(
  options: LynxI18nextOptions,
): LynxI18nextAdapter {
  const instance = options.instance ?? createInstance();
  for (const plugin of options.plugins ?? []) instance.use(plugin);

  let snapshot: LynxI18nextSnapshot = {
    status: "idle",
    direction: "ltr",
  };
  let initialization: Promise<I18nextInstance> | undefined;
  const persistence = resolvePersistence(options.persistence);
  let languageChangeQueue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const setSnapshot = (next: LynxI18nextSnapshot) => {
    snapshot = next;
    notify();
  };
  const syncSnapshot = (
    status: LynxI18nextSnapshot["status"],
    error?: unknown,
  ) => {
    const language = instance.resolvedLanguage ?? instance.language;
    setSnapshot({
      status,
      ...(language ? { language } : {}),
      ...(instance.resolvedLanguage
        ? { resolvedLanguage: instance.resolvedLanguage }
        : {}),
      direction: instance.dir(language),
      ...(error === undefined ? {} : { error }),
    });
  };

  const onLanguageChanged = () => syncSnapshot("ready");
  const onLoaded = () => syncSnapshot("ready");
  const onFailedLoading = (
    _language: string,
    _namespace: string,
    message: string,
  ) => syncSnapshot("error", new Error(message));
  instance.on("languageChanged", onLanguageChanged);
  instance.on("loaded", onLoaded);
  instance.on("failedLoading", onFailedLoading);

  const init = (): Promise<I18nextInstance> => {
    if (initialization) return initialization;
    syncSnapshot("loading");
    initialization = persistedLocale(persistence, options.defaultLocale)
      .then((locale) => instance.init(buildInitOptions(options, locale)))
      .then(() => {
        syncSnapshot("ready");
        return instance;
      })
      .catch((error: unknown) => {
        initialization = undefined;
        syncSnapshot("error", error);
        throw toError(error);
      });
    return initialization;
  };

  const afterInit = async <T>(operation: () => Promise<T>): Promise<T> => {
    await init();
    try {
      const result = await operation();
      syncSnapshot("ready");
      return result;
    } catch (error: unknown) {
      syncSnapshot("error", error);
      throw toError(error);
    }
  };

  return {
    instance,
    t: ((...args: Parameters<I18nextInstance["t"]>) =>
      instance.t(...args)) as I18nextInstance["t"],
    dispose: () => {
      instance.off("languageChanged", onLanguageChanged);
      instance.off("loaded", onLoaded);
      instance.off("failedLoading", onFailedLoading);
      listeners.clear();
    },
    snapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    init,
    changeLanguage: (locale) => {
      const operation = languageChangeQueue.then(async () => {
        await afterInit(() => instance.changeLanguage(locale));
        const resolved = instance.resolvedLanguage ?? instance.language;
        await saveLocale(persistence, resolved);
        return resolved;
      });
      languageChangeQueue = operation.catch(() => undefined);
      return operation;
    },
    loadLanguages: (locales) =>
      afterInit(() => instance.loadLanguages(locales)),
    loadNamespaces: (namespaces) =>
      afterInit(() => instance.loadNamespaces(namespaces)),
    hasLoadedNamespace: (namespace) => instance.hasLoadedNamespace(namespace),
    direction: (locale) => instance.dir(locale),
  };
}

function buildInitOptions(
  options: LynxI18nextOptions,
  defaultLocale = options.defaultLocale,
): I18nextInitOptions {
  const initOptions = options.initOptions ?? {};
  return {
    ...initOptions,
    lng: defaultLocale,
    fallbackLng: options.fallbackLocale,
    supportedLngs: normalizeList(options.supportedLocales),
    resources: options.resources ?? {},
    ...(options.namespaces ? { ns: options.namespaces } : {}),
    ...(options.defaultNamespace
      ? { defaultNS: options.defaultNamespace }
      : {}),
  } as I18nextInitOptions;
}

function resolvePersistence(
  value: LynxI18nextOptions["persistence"],
): LocalePersistenceOptions | undefined {
  if (value === false) return undefined;
  if (value === "auto" || value === undefined) {
    const storage = createLynxLocaleStorage();
    return storage ? { storage } : undefined;
  }
  return value;
}

function validLocale(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(value)
  );
}

async function persistedLocale(
  persistence: LocalePersistenceOptions | undefined,
  fallback: string,
): Promise<string> {
  if (!persistence) return fallback;
  try {
    const stored = await persistence.storage.get(
      persistence.key ?? DEFAULT_LOCALE_KEY,
    );
    return validLocale(stored) ? normalizeLocale(stored) : fallback;
  } catch (error) {
    if (persistence.onError === "throw") throw error;
    return fallback;
  }
}

async function saveLocale(
  persistence: LocalePersistenceOptions | undefined,
  locale: string,
): Promise<void> {
  if (!persistence) return;
  try {
    await persistence.storage.set(
      persistence.key ?? DEFAULT_LOCALE_KEY,
      locale,
    );
  } catch (error) {
    if (persistence.onError === "throw") throw error;
  }
}
