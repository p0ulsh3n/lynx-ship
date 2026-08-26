# Compatibility baseline

This local foundation supports Node.js 22, 24 and 26. CI verifies Node 24 LTS
and the current Node 26 release. The doctor flags odd-numbered EOL releases
such as Node 25; production workers must pin a tested Active or Maintenance
LTS image/version instead of silently changing runtime underneath a build.

## Framework adapters

LynxShip detects the framework from project-owned package and configuration
files and keeps the native host pipeline shared:

- ReactLynx, Vue Lynx and Vanilla Lynx use the project's pinned Rspeedy
  command and configuration.
- Octane uses the official @octanejs/rspeedy-plugin integration when the
  project provides it. The official Octane Lynx docs currently label native
  support early access and say the Lynx packages are not published yet, so
  LynxShip reports that boundary instead of installing an invented version.
- Miso uses the upstream Haskell/Nix flake. LynxShip uses the flake's default
  or bundle output when it exposes one, and accepts
  build.<profile>.miso.attribute for custom outputs. It runs nix build, verifies
  result/main.lynx.bundle (or the configured artifact), and copies it into
  dist/ before the native host build.
- MicroHs is an opt-in experimental adapter contract. LynxShip can acquire a
  pinned host binary from a local path or HTTPS manifest, verify SHA-256 and an
  optional Ed25519 signature, and invoke the project's adapter. The adapter is
  responsible for actual Miso compatibility and must write the configured
  bundle. The official MicroHs repository currently has no verified release
  artifacts, so no public download URL is assumed or fabricated.

The framework detector is advisory for ReactLynx, Vue and Vanilla Lynx, and
enforces the required Nix/bundle boundary for Miso. A successful bundle build
does not imply that an experimental framework is production-ready.

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

## Miso/MicroHs source review

Reviewed 2026-08-26 against the current upstream sources: [MicroHs
repository](https://github.com/augustss/MicroHs), [Miso
repository](https://github.com/dmjio/miso), [Miso-Lynx
repository](https://github.com/haskell-miso/miso-lynx), [Miso-Lynx
gallery](https://github.com/haskell-miso/miso-lynx-gallery) and the [Miso.Native
API](https://haddocks.haskell-miso.org/miso/Miso-Native.html). MicroHs is a
small Haskell implementation/compiler with its own supported subset and
runtime; it must not be described as PrimJS or as a proven GHCJS replacement.
The current Miso sources still expose GHC/GHCJS-oriented dependencies and
FFI, while MicroHs upstream does not provide a verified release artifact
fleet. That is why the implementation is an adapter boundary with a tested
fallback, not an automatic compiler swap.

The reproducible compatibility smoke test used the current MicroHs checkout
at commit `45d0cdb9b7edb15a78f236074d7a6a0adc737aea` (version `0.16.6.0`) and
the current `haskell-miso/miso-lynx-gallery` checkout at commit
`7ef5e1c38e51a1b77734896ce14ebd7a57624fba`. MicroHs itself compiled on the
Windows test machine, but `mhs -fno-code Main.hs` rejected the gallery at
`$(makeLenses ''Drag)` in `Main.hs:81`. The LynxShip MicroHs path therefore
fails with `BUILD_MISO_MICROHS_ADAPTER_FAILED` and produces no bundle. This is
an observed upstream compatibility gap, not a missing CLI flag; the official
GHC/Nix path remains the supported Miso build until Miso has a MicroHs port or
a compatible adapter.
