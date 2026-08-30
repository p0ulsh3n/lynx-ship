# @lynxship/navigation

Navigation contracts and native adapters for Lynx applications. The package
keeps the validated controller API host-neutral and also ships an Android/iOS
Lynx native module. A host can implement `LynxShipNavigationHost` to route
Lynx pages through its native stack; without one, a validated local `bundle`
opens the built-in full-page host, while safe URLs without a bundle are
delegated to the platform deep-link system.

```ts
import { createNavigationController } from "@lynxship/navigation";

const navigation = createNavigationController({
  platform: "android",
  adapter: androidNavigationAdapter,
  policy: { httpsHosts: ["app.example.com"] },
});

await navigation.open({ url: "lynxship://chat/42" });

await navigation.navigate({
  path: "pages/chat.lynx.bundle",
  params: { conversationId: "42" },
  presentation: {
    title: "Chat",
    hideNavBar: false,
    forceThemeStyle: "system",
  },
});

await navigation.close();
```

Android applications can opt into a native back-press event when a Lynx page
must decide whether to leave (for example, to save a draft or confirm an
unsaved form). The default behavior remains native back navigation. When the
feature is enabled, Android 13+ uses `OnBackInvokedDispatcher` and older
supported Android versions use the compatibility callback; both emit the same
Lynx global event:

```ts
await navigation.setBackPressHandling(true);
// Listen for `lynxship:navigation-back-press` in the Lynx page.
// Call navigation.back() only after the page accepts the navigation.
await navigation.setBackPressHandling(false);
```

This is deliberately opt-in and fail-closed: a host without the native
capability receives `NAVIGATION_CAPABILITY_MISSING`, and disabling the mode
restores the platform's normal back behavior. The event does not carry
application data; the page reads its own state and explicitly confirms the
navigation.

Navigation can also be guarded before any native side effect. Interceptors run
in declaration order, may redirect to another validated target, or may cancel
with a typed error. Redirect loops are bounded and a cancelled request never
changes the logical stack:

```ts
const navigation = createNavigationController({
  platform: "android",
  adapter: androidNavigationAdapter,
  interceptors: [
    ({ target }) =>
      target.url === "lynxship://private"
        ? { target: { url: "lynxship://login" } }
        : undefined,
    ({ target }) =>
      target.url.startsWith("lynxship://admin")
        ? { cancel: true, reason: "Admin access is required." }
        : undefined,
  ],
});
```

This provides a stable place for authentication, feature flags, analytics
consent and tenant route policy without putting those concerns into a native
router or an application-wide mutable singleton.

The controller also exposes Sparkling-style non-presenting creation and system
browser operations when the installed native host supports them:

```ts
await navigation.create?.({ url: "hybrid://prefetched" });
await navigation.openInSystemBrowser?.({ url: "https://example.com/help" });
```

`create` never changes the logical navigation stack. `openInSystemBrowser` only
accepts HTTPS targets and never sends Lynx routes to a browser. Hosts that do
not implement either optional native capability receive the typed
`NAVIGATION_CAPABILITY_MISSING` error instead of a false success.

Full-page hosts can also expose a native toolbar through the portable chrome
contract. It is declarative JSON rather than a native view, so the same model
can be rendered by Android, iOS, Web or Desktop hosts and remains safe to pass
over the Lynx bridge. The Android and iOS adapters include a default full-page
Lynx host for a local `bundle` query parameter; application-owned hosts still
take precedence. The default host injects the same reserved context as the
reusable containers: platform, device and screen metrics, safe area, locale,
theme, accessibility, power state, lifecycle state, stable container ID and
bounded `queryItems`.

```ts
await navigation.updateChrome({
  title: "Inbox",
  backgroundColor: "#071522",
  leadingAction: {
    id: "back",
    role: "back",
    accessibilityLabel: "Go back",
    icon: "arrow-left",
  },
  trailingActions: [
    { id: "compose", role: "action", accessibilityLabel: "Compose" },
  ],
});
```

Action identifiers, labels, colors, count, enabled/destructive state,
accessibility labels and serialized size are validated before the native adapter
is called. Android and iOS render both leading and trailing actions and send
non-navigation actions back as the bounded `lynxship:navigation-action` event.
The optional `icon` is resolved by the host: Android looks up a safe application
`drawable` resource name, while iOS uses a safe SF Symbols name. If the icon is
missing or unavailable, the action falls back to its accessible text (and the
default back icon where applicable); applications do not need to ship a
platform-specific icon to use the contract.
`updateChrome()` does not alter the logical route stack. It is an optional host capability: a host
that has no toolbar renderer receives `NAVIGATION_CAPABILITY_MISSING`, never a
false success. Native hosts implement the optional
`LynxShipNavigationHost.updateChrome`/`lynxShipUpdateChromeJSON` callback and
remain responsible for rendering with their platform accessibility APIs.

For multi-page hosts, build the same safe bundle scheme used by native Lynx
routers instead of concatenating query strings manually:

```ts
import { buildLynxScheme, parseLynxScheme } from "@lynxship/navigation";

const url = buildLynxScheme({
  path: "pages/chat.lynx.bundle",
  params: { title: "Chat", hide_nav_bar: 1 },
});
const page = parseLynxScheme(url);
```

The builder percent-encodes values, rejects absolute or unsafe bundle paths and
uses the same scheme allowlist as the navigation controller. `bundle` is
required when parsing so a native host cannot accidentally open an arbitrary
scheme URL as a Lynx page.

Presentation hints map to the documented Lynx container scheme parameters:
title, navigation/status-bar visibility, transparent status bars, colors, theme,
intrinsic `FitSize`, orientation/status-font preferences, and loading/error
surface policy. Light/dark color variants are selected by the forced container
theme (or the current system theme on native full-page hosts). `hideLoading` and
`hideError` suppress only the default full-page host overlays; they never hide a
Lynx page or swallow a lifecycle error. `loadingBackgroundColor` controls the
host background while the bundle is loading. These values are validated before
reaching a native adapter and are also honored by the built-in Android/iOS
full-page hosts.
`close()` is a semantic close operation; legacy adapters without a close method
fall back to `back()` so existing hosts remain source-compatible. The controller
also exposes a read-only logical `stack`: `open()` pushes, `replace()` swaps the
top entry, and a successful `back()` or `close()` pops one entry. Native adapters
remain the source of truth for whether a transition actually changed the host.
The built-in Android full-page host opts into the official predictive-back API
on Android 13 and newer, while retaining the compatibility `onBackPressed()`
path on older supported versions. The compatibility path is only intercepted
when `setBackPressHandling(true)` is enabled.

For a pure Lynx application, create the platform adapter after installing and
autolinking this package:

```ts
import {
  createLynxNavigationAdapter,
  createNavigationController,
} from "@lynxship/navigation";

const navigation = createNavigationController({
  platform: "android",
  adapter: createLynxNavigationAdapter("android"),
});
await navigation.open({ url: "lynxship://home" });
```

The native module has no mutable global host registry. Android resolves the
nearest `Activity` implementing `LynxShipNavigationHost`; iOS resolves the
active controller implementing `LynxShipNavigationHost`. Those host callbacks
own route mapping and must validate their own application-specific routes.

When no application-owned host is present, an URL such as
`hybrid://lynxview_page?bundle=main.lynx.bundle` opens the package's non-exported
native page host on Android or iOS. The host reads only an embedded, validated
relative bundle, forwards lifecycle events to Lynx, and releases its view when
the page is destroyed. URLs without a `bundle` remain delegated to the
application/platform deep-link handler, preserving existing brownfield routes.

The default policy accepts `lynx:`, `lynxship:` and `https:` URLs. HTTPS hosts
can be restricted with `httpsHosts`; credentials, control characters and
unsupported schemes are rejected before the native adapter is called. The
adapter remains responsible for Android App Links, Apple Universal Links,
Harmony routing, browser history and actual stack transitions.

The TypeScript controller remains free of network requests, filesystem writes,
global singletons, native imports and platform side effects. Native behavior is
confined to the explicitly installed Android/iOS module and its host callback.
