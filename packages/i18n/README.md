# @lynxship/i18n

Explicit-state translation primitives for Lynx applications. It normalizes
BCP-47-style locale identifiers, resolves locale fallback chains, supports
interpolation and plural keys, and does not assume that `Intl` is available in
every Lynx runtime.

For larger applications, compose these pure helpers with an established i18n
library rather than treating this package as a replacement for one. The
optional `@lynxship/i18n/i18next` entrypoint provides the tested i18next
adapter, resource backend and cache contracts; install `i18next` explicitly
when using that entrypoint. The official Lynx guidance recommends `i18next`,
static or lazy resource loading, and translation extraction. Lynx currently
does not guarantee the `Intl` API; use the required polyfills when using
locale-sensitive number/date formatting or i18next's modern plural
implementation. See the current guidance:
<https://lynxjs.org/next/guide/inclusion/internationalization.html>.

## Usage and boundaries

Keep the locale and message catalog in application state and pass them to the
pure helpers; the package does not mutate globals or automatically fetch
translations. `setLocale()` notifies subscribers so a host can update its
render state, but it does not render UI by itself. It supports portable
fallback, interpolation and common plural rules. For complete CLDR coverage,
inject `pluralCategory` or use the official `i18next` path with the necessary
polyfill. Domain-specific ICU formatting, lazy loading, persistence and
translation extraction remain choices of the host application. RTL is a
resolved value that the UI layer must apply to its layout using Lynx direction
and logical properties.

## i18next adapter

```ts
import {
  createLynxI18next,
  createLynxResourceBackend,
} from "@lynxship/i18n/i18next";

const adapter = createLynxI18next({
  defaultLocale: "en",
  fallbackLocale: "en",
  supportedLocales: ["en", "fr"],
  resources: { en: { common: { hello: "Hello" } } },
  plugins: [
    createLynxResourceBackend({
      loader: {
        async load(language, namespace) {
          return loadTranslationResource(language, namespace);
        },
      },
    }),
  ],
  initOptions: {
    partialBundledLanguages: true,
    ns: ["common"],
  },
});

await adapter.init();
adapter.t("hello", { ns: "common" });
await adapter.changeLanguage("fr");
```

`init()` must be awaited before rendering resources loaded by a backend.
`createLynxI18next()` creates an isolated i18next instance by default and does
not initialize anything at import time. Use an injected `instance` when a host
already owns one. The adapter does not install `Intl` polyfills, choose a
remote endpoint, or execute translations as code. By default it attempts
best-effort locale persistence through LynxShip's
`NativeModules.LynxShipDeviceStorage` bridge or browser `localStorage` when
one is available. This lookup occurs only when `init()` is called and never
performs network I/O. For deterministic applications, inject the storage
explicitly:

```ts
const adapter = createLynxI18next({
  defaultLocale: "en",
  fallbackLocale: "en",
  supportedLocales: ["en", "fr"],
  persistence: {
    key: "settings.language",
    storage: {
      get: async (key) => myStorage.get(key),
      set: async (key, value) => myStorage.set(key, value),
    },
  },
});
```

Use `persistence: false` to disable the automatic lookup, or
`onError: "throw"` when storage availability is a hard application invariant.
Storage failures are ignored by default so the translation UI can still start.

For a new Lynx project, `lynxship i18n setup` installs compatible runtime
packages, generates static `Intl` imports and adds the bootstrap import to the
detected entry file. Use `--dry-run` to review the plan first. The command
does not edit an ambiguous entry point or download anything at runtime.

Use the portable capability planner when a target runtime may have partial
`Intl` support:

```ts
import { planIntlPolyfills, type IntlCapability } from "@lynxship/i18n";

const required: IntlCapability[] = ["PluralRules", "NumberFormat"];
const polyfills = planIntlPolyfills(required);
```

The result names the official FormatJS package and entry points required for
the missing capabilities. It never installs packages, mutates `globalThis`,
or downloads locale data. Import only the polyfill and locale data required by
the application, before creating the i18next instance. The
`examples/lynx-i18n-demo` fixture exercises `Intl.PluralRules` with English,
French and Arabic locale data in a real Rspeedy bundle.

For Lynx bundles produced with the official translation-dedupe plugin, use
`loadLynxI18nextCustomSection()` as the explicit resource source. It reads the
`i18next-translations` custom section supplied by the Lynx runtime and maps its
locale objects to i18next's `translation` namespace. It returns an empty
resource object when the host does not expose custom sections, so callers can
provide a tested local fallback; the runtime read is confined to this explicit
call.

ReactLynx applications can use the optional `@lynxship/i18n/react-lynx`
entrypoint. It provides `LynxI18nextProvider` and `useLynxI18next`; install
`@lynx-js/react` explicitly for this entrypoint. The hook subscribes to the
adapter lifecycle and exposes `ready`, `locale`, `direction` and the
namespace-bound `t` function. Network and storage work remains behind the
injected loader/cache and is not performed on the rendering thread.
