# ReactLynx i18next fixture

This private fixture validates the LynxShip i18next adapter in a real
Rspeedy/ReactLynx bundle. It includes English, French and Arabic resources,
RTL direction, plural categories, and the official FormatJS `PluralRules`
polyfill with locale data.

## Commands

```bash
pnpm --filter @lynxship/lynx-i18n-demo typecheck
pnpm --filter @lynxship/lynx-i18n-demo build
pnpm i18n:fixture:check
```

The optional `build:i18n` script enables Lynx's official
`rsbuild-plugin-i18next-extractor` integration. It is kept separate from the
default build because the extractor analyses the complete Rspack module graph
and can require substantial memory on Windows.

`build:i18n:dedupe` additionally enables Lynx's official
`@lynx-js/i18next-translation-dedupe` plugin. With the current fixture's
Rspeedy version, that upstream plugin currently fails in its `customSections`
hook (`Cannot read properties of undefined (reading '0')`); this is recorded
as an external compatibility gate and is not hidden behind a fake success.

The fixture does not claim device-level Android/iOS execution. Those remain
external runtime gates because the host must provide the real Lynx runtime and
custom-section APIs.
