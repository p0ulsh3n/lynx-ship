# Expo and LynxShip integration

`@lynxship/expo` is the supported brownfield integration for embedding an
official Lynx `LynxView` in an Expo/React Native application. It is not a
WebView: the native Android or iOS view hosts the Lynx engine and receives a
compiled `.lynx.bundle` through Lynx's native template-provider API.

## What the package automates

The package provides:

- an Expo Modules API native view for Android and iOS;
- official Lynx Android and CocoaPods dependencies, pinned to a declared Lynx
  version;
- Lynx environment initialization and native bundle-provider wiring;
- the embedded bundle fallback;
- the LynxShip OTA clients, with HTTPS enforcement, Ed25519 manifest
  verification, SHA-256 asset verification, size/path limits, atomic staging,
  activation and last-known-good rollback;
- an Expo config plugin that writes only public runtime configuration and
  never puts a private signing key in the application.

The package follows Expo's `app.plugin.js` package entry-point convention, so
adding `@lynxship/expo` to the app's `plugins` list lets `npx expo prebuild`
apply the native configuration. It does not modify native files at package
installation time.

## What remains an application decision

The application still owns its Expo navigation and layout, the bundle it
ships as the embedded fallback, its project ID/channel/runtime version, and
the public OTA key set. Those values are not secrets. The OTA private key and
R2 credentials must stay in LynxShip or CI secret storage.

Native changes remain native changes: changing the Lynx runtime, native
permissions, native modules, services or Autolink inputs requires a new
Android/iOS binary. OTA is limited to compatible Lynx JavaScript/assets.

## Configuration

```json
{
  "expo": {
    "plugins": [
      [
        "@lynxship/expo",
        {
          "endpoint": "https://api.example.com",
          "projectId": "00000000-0000-4000-8000-000000000000",
          "channel": "production",
          "runtimeVersion": "lynx-runtime-2026-01",
          "publicKeys": {
            "release-key-1": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
          },
          "embeddedBundle": "main.lynx.bundle",
          "bundlePath": "../lynx-app/dist/main.lynx.bundle",
          "syncBundle": true,
          "lynxVersion": "auto"
        }
      ]
    ]
  }
}
```

`lynxVersion` defaults to `auto`: Gradle resolves the current Android release
and CocoaPods resolves the current iOS release. The native package managers'
lockfiles record the concrete versions selected, so repeated builds do not
silently drift. An exact semver can still be supplied for a controlled release
lane. Before refreshing a lockfile, check the current Lynx integration page,
the Android artifacts, CocoaPods specifications and the project's compatibility
tests. The plugin performs only a local filesystem sync in its dangerous-mod
hooks; it never downloads a compiler, resolves a remote artifact, or runs a
Lynx build during prebuild.

`bundlePath` identifies the generated `.lynx.bundle` relative to the Expo
project. During `expo prebuild`, the plugin copies the complete Rspeedy output
directory beside that bundle, including nested `static/` assets, into the
native host. The default is `dist/main.lynx.bundle`; `syncBundle` defaults to
`true`. A missing bundle fails prebuild with an actionable message instead of
creating a native app that cannot render its Lynx screen. Managed manifests
make repeated prebuilds idempotent, remove only stale managed files, and
protect developer-owned files from accidental overwrite.

## Build and release lifecycle

```text
Rspeedy bundle
      ↓
Expo config plugin sync
      ↓
LynxShip build / update
      ↓
signed manifest + immutable R2 assets
      ↓
Expo native module checks runtime compatibility
      ↓
verify signature, paths, sizes and SHA-256
      ↓
stage atomically and keep embedded/last-known-good fallback
      ↓
Lynx template provider returns the active bundle to LynxView
```

The runtime must not download executable native code. If a release changes
native behavior, build a new binary instead of publishing an OTA update.

## Verification matrix

Run JavaScript/package checks on every platform. Run native checks on the
platform that owns the toolchain:

```bash
pnpm --filter @lynxship/expo build
pnpm exec tsx --test test/expo.test.ts

lynxship init
lynxship doctor --platform android
lynxship doctor --platform ios
lynxship ota doctor --platform android
lynxship ota doctor --platform ios
```

For Android, run a clean Gradle build and install the app on an emulator or
device. For iOS, run `pod install`, an Xcode Simulator build, and then a
device/archive build on macOS. The Windows repository checks cannot claim
that an Android or iOS native binary compiled.

## Source policy

This integration follows the official documentation rather than inventing a
second Lynx runtime or native registry:

- [Lynx/Rspeedy existing-app integration](https://lynxjs.org/next/rspeedy/start/integrate-with-existing-apps)
- [Lynx Autolink](https://lynxjs.org/guide/autolink)
- [Expo Modules native view](https://docs.expo.dev/modules/native-view-tutorial/)
- [Expo module configuration](https://docs.expo.dev/modules/module-config/)
- [Expo config plugins](https://docs.expo.dev/config-plugins/mods/)
