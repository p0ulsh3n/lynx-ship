# iOS SDK

Status: Beta native source. Add this directory as a local Swift Package.
`Sources/LynxShipOtaClient.swift` is a small OTA
client for a native Lynx host. It checks `/v1/ota/check`, verifies the Ed25519
manifest and SHA-256 assets with CryptoKit, stages the candidate atomically and
rolls back after repeated failed launches.

The host must embed the public signing key, provide the embedded bundle
fallback, call `beginLaunch()` before rendering, expose
`openActiveAsset("main.lynx.bundle")` through its Lynx template provider, and
call `markLaunchSuccess()` only after Lynx has loaded successfully. Native
executables are never downloaded by this client.

## Reusable Lynx container

The CocoaPods target also exposes `LynxShipContainerView`, a reusable native
container independent of Expo. It accepts an application-owned bundle loader,
so embedded assets and the verified `LynxShipOtaClient` asset store use the
same lifecycle:

```swift
let container = LynxShipContainerView(
  assetLoader: { name in try otaClient.openActiveAsset(name) },
  delegate: self
)
try container.load(bundle: "main.lynx.bundle", initialData: "{}", globalProps: ["theme": "dark"])
```

Call `try container.prepare(bundle: "main.lynx.bundle")` before `load` when the
host wants to warm one verified bundle without presenting a view. Each
instance exposes a stable `containerID` and `isLoadSuccess`; success is only
reported after Lynx's first-screen callback. It provides
`prepare`, `load`, `reload`, `updateData`, `updateGlobalProps`,
`updateGlobalPropsByIncrement`, `sendGlobalEvent`, `updateViewport`,
visibility, resource-fetch, first-screen, post-update/error lifecycle callbacks and `release()`. Pass a
`LynxShipContainerUIProvider` to the initializer to supply host-owned loading
and failure overlays. Its error view receives a retry callback; returning
`nil` keeps presentation fully controlled by the host. Preparation
uses a bounded in-memory cache; the host loader still
owns authentication and persistent-cache policy. Calls are main-thread only
and bundle policy remains owned by the host. The Swift Package target
intentionally stays OTA-only and dependency free; the Lynx container is
provided by the CocoaPods target with the official Lynx framework dependency.

Window attachment also forwards to Lynx's official `onEnterForeground()` and
`onEnterBackground()` hooks before the delegate show/hide callbacks.

Automatic host context is enabled by default. The container injects the
reserved Sparkling-compatible fields (`os`, device and screen metrics,
safe-area insets, theme, locale, orientation, accessibility, low-power state,
background state and a stable `containerID`) before the bundle starts and
refreshes dynamic values when its size or the application foreground state
changes. Call `try container.setAutoGlobalProps(false)` only if the host
intentionally owns that complete context; application props cannot overwrite
reserved fields in automatic mode.

`updateData(_:)` forwards JSON `initData` to Lynx's official
`updateDataWithString:` path without remounting the current template. It accepts
at most 8 MiB, invokes `containerDidUpdate` only after Lynx accepts the update,
becomes the data used by a later `reload()` and can optionally select a
registered Lynx data processor.

### Per-container native extensions

Pass a `LynxShipContainerBuilderConfigurator` when the container needs local
custom Lynx UI elements or another builder-level extension. It runs once,
before the official `LynxView` is constructed, and receives the official
`LynxViewBuilder`; the host can use Lynx's documented local registration API
on the builder's `LynxConfig` without changing process-global state. This is
the iOS equivalent of the Android configurator and keeps custom elements
scoped to the container that declares them.

The host remains responsible for implementing the custom element and its
platform dependencies. See Lynx's [custom native element guide](https://lynxjs.org/guide/custom-native-component.html)
for the supported `registerUI` APIs.

Production endpoints must use HTTPS. HTTP is accepted only for localhost
development. The SDK does not bypass Apple's review or native binary update
rules.
