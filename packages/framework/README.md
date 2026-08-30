# @lynxship/framework

Portable framework contracts and lifecycle orchestration for LynxShip hosts.

This package is the framework foundation, not a replacement for the official
Lynx runtime. It defines the boundary that Android, iOS, HarmonyOS, Web and
Desktop adapters can implement while preserving LynxView, TemplateProvider,
Autolink and the official bundle workflow.

## What it provides

- explicit framework lifecycle states;
- platform and capability negotiation;
- a container contract for prepare, mount, first-screen, update, data refresh
  and unmount;
- validated full-page and embedded-container presentation hints, including
  navigation/status-bar policy, theme and intrinsic-size mode;
- no native SDK, cloud provider, filesystem or process side effects;
- deterministic errors suitable for CLI and JSON output;
- dependency injection through the container adapter.
- a validated `app.config.ts`-compatible contract containing `lynxConfig`,
  platform identifiers, asset paths, routes and plugin tuples;
- serialized start/update/dispose operations so host lifecycle callbacks cannot
  race;
- optional first-screen timeout and AbortSignal propagation for native hosts.

The optional `createContainerRuntime` facade adds serialized host controls for
`reload`, runtime `globalProps`, global events, visibility and viewport changes.
It emits typed lifecycle events and rejects calls after release. A platform
adapter still owns the real LynxView, template provider, navigation stack and
native thread dispatch; the portable package never pretends to implement those
platform effects itself.

An application can inject an optional `ContainerUiProvider` as the second
argument. Its `render(event)` method receives `load-start`, `first-screen`,
`error`, `intrinsic-size`, visibility and `released` events, allowing a project
to provide its own loading/error/retry presentation. For a ready-made,
toolkit-neutral state model, use `createContainerUiController`; it exposes
`idle`, `loading`, `ready`, `error` and `released` phases, presentation hints and
an optional retry action. Provider exceptions are isolated and never change the
native container result.

## Usage

The application supplies a platform adapter:

    import { createFramework } from "@lynxship/framework";

    const framework = createFramework({
      platform: "android",
      container: androidContainer,
      capabilities: [
        { id: "navigation", platform: "android", version: "1.0.0" }
      ]
    });

    await framework.start({
      bundle: { id: "main", path: "dist/main.lynx.bundle", sha256: "..." },
      signal: abortController.signal
    });

The package does not create a fake native view, download an unverified bundle
or silently select a platform.

## Container controls

Use the runtime facade when a host exposes the corresponding native controls:

    import { createContainerRuntime } from "@lynxship/framework";

    const runtime = createContainerRuntime(container, {
      ui: {
        render(event) {
          // Map event.type to the app's loading/error/empty UI.
          console.log(event.type);
        },
      },
    });
    await runtime.prepare({ bundle });
    await runtime.mount({
      bundle,
      initialData: {},
      presentation: {
        title: "Chat",
        theme: "system",
        contentMode: "fit-size",
      },
    });
    await runtime.updateGlobalPropsByIncrement({ theme: "dark" });
    await runtime.updateData('{"conversationId":"thread-1"}');
    await runtime.sendGlobalEvent("accountChanged", [{ id: "user-1" }]);
    await runtime.updateViewport({ width: 390, height: 844 });
    await runtime.reload();
    await runtime.unmount();

`mount` and `reload` resolve their `firstScreen` promise only when the adapter
reports the real first-screen signal. An adapter may also return an
`intrinsicSize` signal for embedded content; the runtime validates it and emits
an `intrinsic-size` event. Adapters can additionally provide
`subscribeIntrinsicSize` for live content-size changes; the runtime removes
that subscription on the next mount/reload and on unmount. Operations are serialized, and a missing native
capability produces a typed error instead of silently doing nothing. The
runtime validates viewport dimensions but deliberately leaves navigation,
thread selection, bundle loading and global-props serialization to the native
adapter. This makes the same contract usable by Android, iOS and future hosts
without weakening the official Lynx APIs.

`updateGlobalPropsByIncrement` applies partial runtime context changes without
remounting the bundle. `updateGlobalProps` remains source-compatible and uses
the same incremental adapter operation when available.

`updateData` maps to Lynx's official host-data update API. It changes the
current `initData` without remounting the template, retains the new data for a
later reload, and rejects strings larger than 8 MiB before the native adapter
is called. Pass the optional second argument to select a registered Lynx data
processor, for example `updateData('{"title":"Inbox"}', "normalize")`.
Subscribers receive a `data-update` event only after the adapter accepts the
update; the existing `update` event remains reserved for a bundle update.

`prepare` is an explicit prefetch boundary modelled after native container
preparation APIs: it verifies the bundle reference and delegates caching to the
adapter without mounting a view, changing the active bundle or presenting UI.
It is optional so hosts that cannot prewarm a source fail with a typed
capability error instead of pretending that preparation happened.

## Unified app configuration

The framework can expose one configuration object while leaving the actual
Rspeedy configuration untouched:

    import { defineLynxShipAppConfig } from "@lynxship/framework";
    import { defineConfig } from "@lynx-js/rspeedy";

    export default defineLynxShipAppConfig({
      lynxConfig: defineConfig({ source: { entry: { main: "./src/main.tsx" } } }),
      appName: "Example",
      appIcon: "assets/icon.png",
      splashScreen: { backgroundColor: "#071522", image: "assets/splash.png" },
      router: { baseScheme: "hybrid://lynxview_page", initialRoute: "/" },
      paths: { android: "android/app/src/main/assets" },
      routes: [{ name: "home", bundle: "main.lynx.bundle", path: "/" }],
    });

Validation is pure and rejects unsafe paths, duplicate routes/plugins and
invalid Android/iOS identifiers before a host or plugin performs any effect.
The framework does not load, transform or replace `lynxConfig`.

Sparkling-style `app.config.ts` route and plugin shapes are also accepted as an
additive compatibility layer. `router.routes` is a named route map,
`router.main` declares the initial bundle, and `plugin` is an alias for
`plugins`. Tooling can call `normalizeLynxShipAppConfig(config)` to obtain one
canonical `routes`/`plugins` view; duplicate entries are retained once, while
the original config object remains untouched.

Pass `firstScreenTimeoutMs` when the host has an operational startup budget.
It is intentionally unset by default so existing hosts keep their current
behavior; an aborted or timed-out start transitions to `failed` and can be
retried with the same framework instance.

## Boundaries

Navigation, native bridge implementations, signing, OTA storage, CLI process
execution and cloud workers belong to their own packages. They depend on these
contracts rather than making this package depend on a provider.

The package remains beta until Android, iOS, HarmonyOS, Web and Desktop
adapters have independent compile and runtime acceptance evidence.
