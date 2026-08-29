import type {
  BackendModule,
  InitOptions,
  Resource,
  ResourceKey,
} from "i18next";
import type {
  CachedResourceLoaderOptions,
  LynxResourceBackendOptions,
  ResourceCacheEntry,
  LynxCustomSectionRuntime,
  ResourceLoader,
  ResourceNamespace,
} from "./contracts.js";

export const I18NEXT_TRANSLATIONS_SECTION = "i18next-translations";

function isResourceNamespace(value: unknown): value is ResourceNamespace {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cacheKey(
  version: string,
  language: string,
  namespace: string,
): string {
  return JSON.stringify([version, language, namespace]);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createLynxResourceBackend(
  options: LynxResourceBackendOptions,
): BackendModule<LynxResourceBackendOptions> {
  return {
    type: "backend",
    init: (_services, _backendOptions, _i18nextOptions: InitOptions) => {},
    read: (language, namespace, callback) => {
      void options.loader
        .load(language, namespace)
        .then((value) => {
          if (!isResourceNamespace(value)) {
            callback(new Error("Translation resource must be an object"), null);
            return;
          }
          callback(null, value);
        })
        .catch((error: unknown) => callback(toError(error), null));
    },
  };
}

export function createCachedResourceLoader(
  options: CachedResourceLoaderOptions,
): ResourceLoader {
  const now = options.now ?? Date.now;
  const pending = new Map<string, Promise<ResourceNamespace>>();

  const read = async (
    language: string,
    namespace: string,
  ): Promise<ResourceNamespace> => {
    const key = cacheKey(options.version, language, namespace);
    const existing = pending.get(key);
    if (existing) return existing;

    const request = (async () => {
      const cached = await options.cache.get(key);
      if (
        cached &&
        cached.version === options.version &&
        (cached.expiresAt === undefined || cached.expiresAt > now())
      ) {
        return cached.value;
      }

      try {
        const value = await options.loader.load(language, namespace);
        if (!isResourceNamespace(value)) {
          throw new Error("Translation resource must be an object");
        }
        const entry: ResourceCacheEntry = {
          value,
          version: options.version,
          ...(options.ttlMs === undefined
            ? {}
            : { expiresAt: now() + Math.max(0, options.ttlMs) }),
        };
        await options.cache.set(key, entry);
        return value;
      } catch (error: unknown) {
        if (options.allowStaleOnError && cached) return cached.value;
        if (options.cache.remove) await options.cache.remove(key);
        throw toError(error);
      }
    })().finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  };

  return { load: read };
}

export function createMemoryResourceCache(): {
  get(key: string): Promise<ResourceCacheEntry | undefined>;
  set(key: string, entry: ResourceCacheEntry): Promise<void>;
  remove(key: string): Promise<void>;
} {
  const entries = new Map<string, ResourceCacheEntry>();
  return {
    async get(key) {
      return entries.get(key);
    },
    async set(key, entry) {
      entries.set(key, entry);
    },
    async remove(key) {
      entries.delete(key);
    },
  };
}

export function createStaticResourceLoader(
  resources: Readonly<Record<string, Readonly<Record<string, ResourceKey>>>>,
): ResourceLoader {
  return {
    async load(language, namespace) {
      const value = resources[language]?.[namespace];
      if (!isResourceNamespace(value)) {
        throw new Error(
          `Missing translation resource: ${language}/${namespace}`,
        );
      }
      return value;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeWithCustomSections(): LynxCustomSectionRuntime | undefined {
  const candidate = (globalThis as { lynx?: unknown }).lynx;
  if (
    !isRecord(candidate) ||
    typeof candidate.getCustomSectionSync !== "function"
  ) {
    return undefined;
  }
  return candidate as unknown as LynxCustomSectionRuntime;
}

export function loadLynxI18nextCustomSection(
  runtime: LynxCustomSectionRuntime = runtimeWithCustomSections() ?? {
    getCustomSectionSync: () => undefined,
  },
  sectionKey = I18NEXT_TRANSLATIONS_SECTION,
): Resource {
  const raw = runtime.getCustomSectionSync(sectionKey);
  if (!isRecord(raw)) return {};

  const resources: Resource = {};
  for (const [locale, translations] of Object.entries(raw)) {
    if (isResourceNamespace(translations)) {
      resources[locale] = { translation: translations };
    }
  }
  return resources;
}
