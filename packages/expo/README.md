# @lynxship/expo

Expo Modules API integration for embedding an official Lynx `LynxView` inside
an Expo/React Native application. The native view uses the LynxShip Android or
iOS OTA client when an OTA endpoint is configured and otherwise renders the
embedded `main.lynx.bundle` fallback.

## Install

```bash
npx expo install @lynxship/expo
npx expo prebuild
npx pod-install
```

Add the config plugin to `app.json` or `app.config.ts`:

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
          "lynxVersion": "auto"
        }
      ]
    ]
  }
}
```

The endpoint must be HTTPS outside localhost. The public verification key is
safe to ship in the application; private signing keys must remain in the
LynxShip CLI or CI secret store.

`lynxVersion` defaults to `auto`. Android resolves the current Lynx release
through Gradle and iOS resolves the current CocoaPods release. Gradle and
CocoaPods lockfiles retain the concrete versions selected by the first native
install, so normal rebuilds remain reproducible. Set an exact semver only when
you intentionally operate a pinned native compatibility lane; do not put
`latest` in a production lockfile without reviewing the resulting native
build.

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

From the Expo project:

```bash
lynxship init
lynxship doctor --platform android
lynxship doctor --platform ios
lynxship build --platform android --profile production
lynxship build --platform ios --profile production
lynxship ota doctor --platform android
lynxship ota doctor --platform ios
```

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
