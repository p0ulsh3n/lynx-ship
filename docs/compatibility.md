# Compatibility baseline

This local foundation supports Node.js 22, 24 and 26. CI verifies Node 24 LTS
and the current Node 26 release. The doctor flags odd-numbered EOL releases
such as Node 25; production workers must pin a tested Active or Maintenance
LTS image/version instead of silently changing runtime underneath a build.

## Automatic native compatibility

The CLI computes a deterministic runtime fingerprint for every build and OTA
publish. It includes the project lockfile, Lynx package versions, the selected
platform's native source/configuration files, and `lynx.lib.json` manifests
used by Lynx native-library autolinking. The fingerprint stores hashes only;
credential and keystore contents are never printed or persisted, while
generated bundles and build output are excluded from the native scan.

The real `update` command compares the current fingerprint with the latest
successful binary build. If they differ, publication is blocked and the CLI
requires a new binary build. This is the safe default for Android and iOS:
JavaScript-only changes can use OTA, while native code, permissions, native
dependencies, Lynx engine changes and autolink changes require a new store
artifact. A `runtimeVersion` policy of `manual` is available for teams that
operate an independently verified native compatibility contract.

This follows Lynx's native library/autolink model and its Native Modules
boundary; the CLI uses the package manifest as build input and does not attempt
to move native executable code through OTA. See the official
[Lynx native library and autolink guide](https://lynxjs.org/guide/autolink) and
[Native Modules guide](https://lynxjs.org/3.6/guide/use-native-modules.html).

When a project contains a platform-specific `lynx.lib.json`, `lynxship doctor`
and `lynxship build` verify the official host integration before continuing.
Android requires `org.lynxsdk.library-settings` in `settings.gradle` and
`org.lynxsdk.library-build` in the application Gradle file. iOS requires the
`cocoapods-lynx-library` plugin and `use_lynx_library!` in `ios/Podfile`.
LynxShip does not rewrite an existing native host automatically because the
Gradle and CocoaPods files belong to the application and may use Groovy,
Kotlin DSL, Bundler or custom build conventions.

The following integrations still require external production verification:

- Android JDK, Gradle, Android Gradle Plugin and SDK.
- macOS, Xcode, Swift, CocoaPods and SPM.
- Google Play and App Store Connect policies/APIs.
- S3/R2 presigned URL behavior and current pricing.

The Windows and Linux CLI can prepare, inspect and validate the iOS workflow,
but only macOS with Xcode can execute `xcodebuild`, sign an IPA, install it on
an Apple target or submit it through Apple's Transporter. This is an operating
system boundary, not a simulated success path.

Every release must update this file with the dated official-source review before promoting a capability to Stable.
