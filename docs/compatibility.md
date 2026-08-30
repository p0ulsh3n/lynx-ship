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
[Native Modules guide](https://lynxjs.org/next/guide/use-native-modules.html).

The public framework layer is split into three host-neutral contracts:
`@lynxship/framework` coordinates container lifecycle and first-screen
readiness, `@lynxship/navigation` delegates validated routes to the native
stack, and `@lynxship/bridge` delegates only allow-listed JS-to-native calls.
None of these packages replaces the official Lynx host or silently creates a
platform implementation.

The native SDKs now also expose reusable Android and iOS
`LynxShipContainerView` implementations. They use an injected bundle loader,
so verified OTA assets and embedded bundles share the same load lifecycle. The
SDKs do not silently choose a network source, navigation stack or privacy
policy; those remain explicit host dependencies.

Both native container SDKs also expose an explicit `prepare` operation. It
loads one verified bundle source without mounting or presenting a view and uses
a bounded in-memory cache for the next load. This is a source-preparation
optimization, not permission to bypass the host's authentication, signature or
persistent-cache policy.

Runtime global-props changes also expose an explicit incremental operation,
`updateGlobalPropsByIncrement`, backed by Lynx's native global-props update
primitive. Existing `updateGlobalProps` callers remain compatible and use the
incremental operation when the adapter provides it.

`updateData` is also available on the portable container and Expo ref. Android
uses `LynxUpdateMeta.Builder`/`updateMetaData`, while iOS uses Lynx's official
`updateDataWithString:` API. Both paths update host-provided `initData` without
remounting and enforce an 8 MiB input limit.

Native containers expose a stable per-instance identifier and a load-success
predicate tied to Lynx's first-screen callback, so hosts can correlate
telemetry and avoid treating a merely started load as usable content.

The container contract also carries validated presentation hints for full-page
or embedded hosts: kind, title, system-bar policy, theme, background and
intrinsic content mode. Native hosts remain responsible for applying those
hints to their own Activity, UIViewController or equivalent container. Hosts
may expose a live intrinsic-size subscription for embedded content; the runtime
validates every update and removes the subscription during reload or unmount.

Navigation exposes a read-only logical stack after native transitions succeed,
with push/replace/pop semantics for multi-page flows. The native adapter remains
the authority for the actual Activity, UIViewController or router transition.
On Android, applications can additionally opt into the modern predictive-back
callback and receive `lynxship:navigation-back-press` before confirming a
navigation in Lynx; disabling the option restores normal platform behavior.
It also exposes optional non-presenting `create` and HTTPS-only
`openInSystemBrowser` operations, matching the native container/router boundary
without pretending that an unsupported host succeeded.
For a direct full-page workflow, the Android/iOS navigation packages also ship
a non-exported default page host for validated local-bundle schemes. An
application-owned `LynxShipNavigationHost` remains authoritative, while a URL
without a `bundle` is still delegated to the application's deep-link handler.
Bridge calls support bounded, opt-in retries only when the caller supplies an
idempotency key; security and contract failures are never retried, while an
optional priority is forwarded as transport metadata. The Android/iOS Lynx
transport accepts the canonical `{ code, msg, data }` response envelope and
also understands the original `{ success, value }` envelope for compatibility.
The host still owns authentication, method allowlists, native thread dispatch
and business error semantics.

The CLI-generated Android and iOS hosts now provide the same baseline behavior
without requiring application code to reinvent it: asynchronous bundle loading,
visible loading and recoverable error states, tap-to-retry, the official Lynx
first-screen readiness callback, adaptive viewport updates and explicit view
cleanup. This is a host baseline, not a claim that an existing custom host has
been rewritten; existing native projects remain application-owned.

The framework also exposes a standard global-props schema modelled on the
public Lynx host context needed by multi-platform containers: OS identity,
container ID, logical screen/content dimensions, safe-area insets, pixel ratio,
accessibility, tablet/notch and low-power indicators, system-bar heights,
orientation, theme, locale, background state and query items. `@lynxship/expo`
injects this context automatically on Android and iOS by default and refreshes
the layout/visibility fields without remounting. Applications can add namespaced
extensions or set `autoGlobalProps={false}` when they own the complete context.
The host remains responsible for supplying truthful values on non-Expo targets.

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
