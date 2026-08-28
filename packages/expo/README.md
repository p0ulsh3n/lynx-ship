# @lynxship/expo

Expo Modules API integration for embedding an official Lynx `LynxView` inside
an Expo/React Native application. The native view uses the LynxShip Android or
iOS OTA client when an OTA endpoint is configured and otherwise renders the
embedded `main.lynx.bundle` fallback.

## Install

Build the Lynx output before the native prebuild. The plugin then copies the
whole Rspeedy output directory, including `static/` assets, into the generated
Android and iOS hosts and records hashes in a managed manifest.

```bash
lynxship build --local
npx expo install @lynxship/expo
npx expo prebuild
npx pod-install
```

`@lynxship/expo` uses the `expo-modules-core` implementation supplied by the
installed Expo SDK. It is declared as a peer dependency so Expo Doctor can
validate the application explicitly; `npx expo install @lynxship/expo` should
select the SDK-compatible version. The workspace keeps a matching development
dependency for its own native-module build.

When the project uses a static `app.json` or `app.config.json`, the Expo CLI
automatically adds `@lynxship/expo` to `expo.plugins` during `npx expo install`.
The plugin's defaults are safe for the first build, so no manual config edit
is required for the basic integration. `npx expo prebuild` then applies the
Android and iOS native changes before the native build.

If the project uses a dynamic `app.config.js`/`app.config.ts`, or if custom OTA
options are needed, add the config plugin manually:

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
          "notifications": {
            "enabled": true,
            "enableBackgroundRemoteNotifications": true,
            "communicationNotifications": true,
            "android": { "defaultChannel": "default" }
          },
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

For a dynamic config, keep the same `plugins` entry in the returned Expo
configuration. Expo cannot safely rewrite JavaScript or TypeScript config
files automatically.

`bundlePath` points to the generated `.lynx.bundle` and is resolved relative
to the Expo project. All files beside that bundle are copied so Rspeedy's
`static/` resources remain available at runtime. The default is
`dist/main.lynx.bundle`. `syncBundle` defaults to `true`; set it to `false`
only when a different native asset pipeline owns the bundle. Prebuild fails
with a repair command if the configured bundle is missing, rather than
producing a native app that opens to a blank Lynx view.

The sync is deterministic and idempotent. LynxShip updates files previously
owned by its manifest, removes only stale files from that manifest, and refuses
to overwrite a developer-owned native asset. The iOS output is added as a
folder resource so nested asset paths are preserved.

The endpoint must be HTTPS outside localhost. The public verification key is
safe to ship in the application; private signing keys must remain in the
LynxShip CLI or CI secret store.

The Android Expo module reads its native Maven version from this package's
`package.json`, so publishing a new package version cannot leave the Gradle
module on an old or missing `versionName`.

`lynxVersion` defaults to `auto`. Android resolves the current Lynx release
through Gradle and iOS resolves the current CocoaPods release. Gradle and
CocoaPods lockfiles retain the concrete versions selected by the first native
install, so normal rebuilds remain reproducible. Set an exact semver only when
you intentionally operate a pinned native compatibility lane; do not put
`latest` in a production lockfile without reviewing the resulting native
build.

## Optional push notifications

When an Expo app also uses `@lynxship/notifications/expo`, set
`notifications.enabled` to `true` in this plugin. LynxShip delegates the
native permission, FCM/APNs token acquisition and build-time configuration to
the official `expo-notifications` package, then the JavaScript adapter sends
the token to the authenticated backend. Install the SDK-selected native
package first:

```bash
npx expo install expo-notifications expo-constants
```

The app must call `LynxShipNotifications.register(...)` with its authenticated
user/project identity and HTTPS registration endpoint. This is intentionally
not guessed by the plugin: app identity and backend authorization are
application data. FCM/APNs credentials also remain in EAS/CI secrets.

For message or presence notifications with profile images, pass an HTTPS
`imageUrl` from the backend payload. Android can render the image directly
through FCM. iOS requires a separate Notification Service Extension target;
use the template published by `@lynxship/notifications` and add it to the Expo
iOS project before an EAS build. The extension is a separately signed native
target, so it cannot be created safely by the JavaScript `LynxView` component
at runtime.

## Use the view

```tsx
import { LynxView } from "@lynxship/expo";

export function LynxScreen() {
  return (
    <LynxView
      style={{ flex: 1 }}
      bundle="main.lynx.bundle"
      initialData="{}"
      reloadOnUpdate
    />
  );
}
```

The native module initializes Lynx, creates the official `LynxView`, and
provides a template provider. The provider first reads the verified active OTA
asset and falls back to the embedded bundle. An OTA release is accepted only
after its runtime, manifest signature, asset paths, sizes and SHA-256 hashes
pass validation. `onReady` is emitted after Lynx reports its first screen, not
merely after the render request is queued. Native code, permissions, native
modules and Lynx runtime changes still require a new binary.

## Build workflow

From the Lynx project, after the bundle has been generated:

```bash
lynxship init
lynxship doctor --platform android
lynxship doctor --platform ios
lynxship build --platform android --profile production
lynxship build --platform ios --profile production
lynxship ota doctor --platform android
lynxship ota doctor --platform ios
```

For a separate Lynx and Expo checkout, keep the bundle path in the Expo plugin
configuration and run the two build stages in this order:

```bash
lynxship --project-dir ../lynx-app build --local
npx expo prebuild --clean
npx eas-cli@latest build --platform android --profile preview
```

EAS receives the Expo project directory, so the Lynx bundle must be generated
and embedded before the cloud upload (or by an explicitly configured CI build
step). Config plugins do not run arbitrary network downloads or compilers
during `prebuild`.

The package does not silently replace an existing native host. `expo prebuild`
and the official Lynx dependencies remain the source of truth for native
project generation. iOS builds still require macOS/Xcode; Android builds use
the Android SDK and Gradle toolchain.

## Official compatibility boundary

This package follows the official brownfield Lynx integration: `LynxView` is a
native Android/iOS view and the host supplies the template provider. Lynx's
engine does not itself implement application-specific network downloads, so
the provider is the integration point for the LynxShip OTA cache.

References:

- [Lynx integration with existing apps](https://lynxjs.org/3.8/guide/start/integrate-with-existing-apps.html)
- [Expo native view modules](https://docs.expo.dev/modules/native-view-tutorial/)
- [Expo module configuration](https://docs.expo.dev/modules/module-config/)
- [LynxShip OTA security and compatibility](../../docs/compatibility.md)

The native targets must be built on their real platform. The repository's
Windows checks validate the JavaScript API, package metadata and generated
configuration; they cannot replace a real Android Gradle or macOS Xcode
runtime build.
