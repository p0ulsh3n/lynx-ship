import type {
  CallbackError,
  InitOptions,
  Module,
  Newable,
  NewableModule,
  Resource,
  ResourceKey,
  TFunction,
  i18n as I18nextInstance,
} from "i18next";

export type I18nextPlugin = Module | NewableModule<Module> | Newable<Module>;

export type I18nextInitOptions = Omit<
  InitOptions,
  "lng" | "fallbackLng" | "supportedLngs" | "resources"
>;

export type ResourceNamespace = Record<string, ResourceKey>;

export interface LynxI18nextOptions {
  readonly defaultLocale: string;
  readonly fallbackLocale: string | readonly string[];
  readonly supportedLocales: readonly string[];
  readonly resources?: Resource;
  readonly namespaces?: readonly string[];
  readonly defaultNamespace?: string;
  readonly plugins?: readonly I18nextPlugin[];
  readonly initOptions?: I18nextInitOptions;
  readonly instance?: I18nextInstance;
  /** Persist the resolved language through an injected or detected adapter. */
  readonly persistence?: LocalePersistenceOptions | "auto" | false;
}

export interface LocaleStorage {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
}

export interface LocalePersistenceOptions {
  readonly storage: LocaleStorage;
  readonly key?: string;
  /** Storage failures are non-fatal by default so translation still renders. */
  readonly onError?: "ignore" | "throw";
}

export type I18nextStatus = "idle" | "loading" | "ready" | "error";

export interface LynxI18nextSnapshot {
  readonly status: I18nextStatus;
  readonly language?: string;
  readonly resolvedLanguage?: string;
  readonly direction: "ltr" | "rtl";
  readonly error?: unknown;
}

export interface LynxI18nextAdapter {
  readonly instance: I18nextInstance;
  readonly t: I18nextInstance["t"];
  readonly dispose: () => void;
  readonly snapshot: () => LynxI18nextSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly init: () => Promise<I18nextInstance>;
  readonly changeLanguage: (locale: string) => Promise<string>;
  readonly loadLanguages: (
    locales: string | readonly string[],
  ) => Promise<void>;
  readonly loadNamespaces: (
    namespaces: string | readonly string[],
  ) => Promise<void>;
  readonly hasLoadedNamespace: (
    namespace: string | readonly string[],
  ) => boolean;
  readonly direction: (locale?: string) => "ltr" | "rtl";
}

export interface ResourceLoader {
  load(language: string, namespace: string): Promise<ResourceNamespace>;
}

export interface ResourceCacheEntry {
  readonly value: ResourceNamespace;
  readonly version: string;
  readonly expiresAt?: number;
}

export interface ResourceCache {
  get(key: string): Promise<ResourceCacheEntry | undefined>;
  set(key: string, entry: ResourceCacheEntry): Promise<void>;
  remove?(key: string): Promise<void>;
}

export interface CachedResourceLoaderOptions {
  readonly loader: ResourceLoader;
  readonly cache: ResourceCache;
  readonly version: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly allowStaleOnError?: boolean;
}

export interface LynxResourceBackendOptions {
  readonly loader: ResourceLoader;
}

export interface LynxCustomSectionRuntime {
  getCustomSectionSync(key: string): unknown;
}

export type ResourceReadError = CallbackError;

export type TranslationFunction = TFunction;
