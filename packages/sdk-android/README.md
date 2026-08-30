# Android SDK

Status: Beta native source. `LynxShipOtaClient.java` is a dependency-light
client for an Android Lynx host. It checks `/v1/ota/check`, verifies the
Ed25519 manifest and SHA-256 assets, downloads into a temporary directory,
commits the candidate atomically, and rolls back after repeated failed
launches.

The application must embed the public signing key, provide the embedded bundle
fallback, and call `beginLaunch()` before rendering. Render
`openActiveAsset("main.lynx.bundle")` through the host's
`AbsTemplateProvider`. Call `markLaunchSuccess()` only after the Lynx view has
successfully loaded. Native code is never downloaded by this client.

## Reusable Lynx container

`LynxShipContainerView` is a reusable embedded container independent of Expo.
It accepts an injected `LynxShipContainerAssetLoader`, so one view can load an
embedded bundle, a verified OTA asset, or another application-owned source:

```java
LynxShipContainerView container = new LynxShipContainerView(
    activity,
    bundleName -> otaClient.openActiveAsset(bundleName),
    new LynxShipContainerListener() {
        @Override public void onFirstScreen(LynxShipContainerView view, String bundle) {
            // The first rendered screen is the readiness signal.
        }
    });
container.prepare("main.lynx.bundle");
container.load("main.lynx.bundle", "{}", Map.of("theme", "dark"));
```

Each instance exposes a stable `getContainerId()` and reports `getState()` /
`isLoadSuccess()`; success is only reported after Lynx's first-screen callback.
The view owns `prepare`, `load`, `reload`, `updateData`, `updateGlobalProps`,
`updateGlobalPropsByIncrement`, `sendGlobalEvent`, visibility, lifecycle
callbacks (including resource-fetch start and post-update) and `release()`. `prepare`
loads one verified bundle into a bounded in-memory cache without mounting the
view; the host loader remains responsible for source authentication and disk
cache policy. Public methods are main-thread only; source loading runs off the
UI thread. The host still owns navigation, authentication, bundle policy,
privacy and loading/error UI. For host-owned loading and failure overlays,
pass a `LynxShipContainerUiProvider` through the four-argument constructor.
Its error view receives a retry callback; returning `null` keeps presentation
fully controlled by the host.

Attach/detach also forwards to Lynx's official `onEnterForeground()` and
`onEnterBackground()` hooks, so a removed container does not keep page lifecycle
work running.

Automatic host context is enabled by default. The container injects the
reserved Sparkling-compatible fields (`os`, device and screen metrics,
safe-area insets, theme, locale, orientation, accessibility, low-power state,
background state and a stable `containerID`) before the bundle starts and
refreshes dynamic values when its size or visibility changes. Call
`setAutoGlobalProps(false)` only if the host intentionally owns that complete
context; application props cannot overwrite reserved fields in automatic mode.

`updateData` forwards JSON `initData` to Lynx's official
`LynxUpdateMeta.Builder`/`updateMetaData` path without remounting the current
template. It accepts at most 8 MiB, invokes `onUpdate` only after Lynx accepts
the update, becomes the data used by a later `reload()` and can optionally
select a registered Lynx data processor.

### Per-container native extensions

Pass a `LynxShipContainerBuilderConfigurator` as the fifth constructor
argument when a container needs local custom Lynx UI behaviors or another
builder-level extension. It runs exactly once before `LynxViewBuilder.build`,
so registration is scoped to this container and does not require process-global
state. The host remains responsible for the custom UI implementation and its
platform dependencies. See Lynx's [custom native element guide](https://lynxjs.org/guide/custom-native-component.html)
for the supported `Behavior` and `LynxUI` APIs.

The source intentionally does not depend on an AndroidX networking or JSON
stack. The host application supplies its endpoint, project, channel, runtime
fingerprint and public key map. Production endpoints must use HTTPS; HTTP is
accepted only for localhost emulator development.

For a local Android project, prefer including this directory as an Android
library module:

```groovy
include ":lynxship-sdk-android"
project(":lynxship-sdk-android").projectDir = file("<path-to>/packages/sdk-android")
dependencies {
    implementation project(":lynxship-sdk-android")
}
```

For a small host that deliberately compiles the source directly, add the
source directory to the app module:

```groovy
sourceSets {
    main.java.srcDirs += file("../../packages/sdk-android/src/main/java")
}
```
