# Native integration checklist

## Android

Official references:

- [Lynx Android integration](https://lynxjs.org/guide/start/integrate-with-existing-apps.html)
- [Official Android host demos](https://github.com/lynx-family/integrating-lynx-demo-projects/tree/main/android)
- [AGP/Gradle compatibility](https://developer.android.com/build/releases/about-agp)
- [Android signing](https://developer.android.com/studio/publish/app-signing)

Required host responsibilities:

1. `LynxEnv` is initialized before any Lynx engine call.
2. `LynxViewBuilder` creates the view with a real template provider.
3. `renderTemplateUrl` loads the bundle that the build pipeline synchronized
   into the application assets.
4. The host has a real application module, release variant, Gradle wrapper,
   Android SDK and Java toolchain.
5. The signing adapter signs the release output and verifies it with the
   platform's official verifier. Never equate `assembleRelease` with a valid
   production signature.

`lynxship android host init`, or the interactive real-build bootstrap, creates
only the minimal host when `android/` is absent. It must refuse to overwrite an
existing host. After generation,
inspect the application ID and add application-specific permissions,
libraries, services and Autolink configuration deliberately.

## iOS

Official references:

- [Lynx iOS integration](https://lynxjs.org/guide/start/integrate-with-existing-apps?platform=ios)
- [Official Swift/Objective-C host demos](https://github.com/lynx-family/integrating-lynx-demo-projects/tree/main/ios)
- [CocoaPods guides](https://guides.cocoapods.org/)
- [Apple code signing](https://developer.apple.com/support/code-signing/)
- [Xcode distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)

Required host responsibilities:

1. CocoaPods supplies the Lynx, PrimJS, service and optional element
   dependencies for the exact Lynx release.
2. `LynxEnv.sharedInstance()` runs before Lynx engine calls.
3. `LynxView` is configured with a `LynxConfig` and a real
   `LynxTemplateProvider` that loads the embedded bundle.
4. The bundle is present in Copy Bundle Resources before archive/export.
5. `xcodebuild archive` and `xcodebuild -exportArchive` run on macOS with
   Xcode, a valid scheme, export options and Apple signing material.
6. The exported `.ipa` is verified with `codesign` before it can be uploaded.

`lynxship ios host init`, or the interactive real-build bootstrap, creates the
minimal Swift/Xcode/CocoaPods host only when `ios/` is absent. It cannot invent an Apple Developer Team, certificate,
provisioning profile, entitlements, capabilities, push configuration or App
Store identity. Those must be supplied by the application owner.

## Existing native hosts

If `android/` or `ios/` already exists, inspect it first. Keep its package or
bundle identifier, native architecture, custom build variants, permissions,
entitlements and signing setup. LynxShip should adapt through declared
configuration and documented hooks; it should not rewrite a production host
to match the minimal template.
