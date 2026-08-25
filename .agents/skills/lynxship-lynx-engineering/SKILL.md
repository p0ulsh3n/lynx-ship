---
name: lynxship-lynx-engineering
description: Develop, integrate, debug, and test LynxJS applications and their Android, iOS, HarmonyOS, Web, or Desktop hosts in LynxShip using current official Lynx, Rspeedy, Lynxtron, and platform guidance.
metadata:
  short-description: LynxJS, Rspeedy, native hosts, modules, and autolinking
---

# LynxShip Lynx engineering

Use this skill for any change involving a LynxJS bundle, Rspeedy/Rspack
configuration, Lynx Explorer, DevTool, Android, iOS, HarmonyOS, Web, or Desktop host integration,
native modules, custom elements, services, Autolink, or OTA runtime
compatibility.

## Non-negotiable engineering rules

1. Read [references/source-policy.md](references/source-policy.md) before
   changing a Lynx-facing API. Verify the current official documentation,
   installed package types, and the upstream source/release that matches the
   project's Lynx version. Never rely on remembered API names or stale blog
   posts.
2. Keep the two layers distinct:
   - a pure Lynx/Rspeedy project produces `dist/*.lynx.bundle`;
   - an Android, iOS, or HarmonyOS native host embeds `LynxView`, initializes
     Lynx, loads the bundle, and owns platform packaging/signing;
   - Web uses the official Rspeedy Web environment and Desktop uses Lynxtron;
     neither target may be represented by a fabricated native host.
     Lynx Explorer is a development host; it is not a production APK or IPA.
3. Never fabricate a native artifact. If a required host, SDK, Xcode tool,
   signing identity, provisioning profile, or bundle is absent, fail with a
   repair instruction and keep the build state failed.
4. Never overwrite an existing `android/` or `ios/` host automatically. Host
   generators may create a host only when the directory is absent and must
   use the official Lynx integration shape.
5. Treat native changes, native permissions, native dependencies, Autolink
   manifests, and host configuration as runtime changes. They require a new
   binary and must invalidate incompatible OTA updates.
6. Use the project's pinned Lynx/Rspeedy versions. Do not silently upgrade
   the framework to make an example compile. If a version is unavailable,
   report the exact package/registry/version mismatch.

## Choose the workflow

- Pure Lynx development or live visualization: read
  [references/lynx-platforms.md](references/lynx-platforms.md), run
  `lynxship dev`, and use the QR URL with Lynx Explorer.
- Android production host or APK/AAB: read
  [references/native-integration.md](references/native-integration.md), use
  `lynxship android host init` or the interactive build host bootstrap only
  for a project without `android/`, then verify Gradle, SDK, the release
  variant, and signing.
- iOS production host or IPA: read the iOS section of
  [references/native-integration.md](references/native-integration.md), use
  `lynxship ios host init` or the interactive build host bootstrap only for a
  project without `ios/`, then verify
  CocoaPods, Xcode, archive/export settings, and Apple signing on macOS.
- HarmonyOS HAP: read the current Harmony integration, use the official
  `harmony/` host, `ohpm`, its pinned `hvigorw` wrapper, and the official HAP
  signing verifier.
- Web bundle: read the current Rspeedy Web integration and verify the
  configured `dist/*.web.bundle` output.
- Desktop package: read the current Lynxtron and lynxtron-builder guidance and
  use the project's electron-builder configuration for packaging/signing.
- Native library, module, element, or service: read the Autolink and native
  module sections of [references/lynx-platforms.md](references/lynx-platforms.md),
  inspect `lynx.lib.json`, run codegen, and test both Android and iOS when the
  library declares both platforms.
- Rendering, runtime, or device debugging: read
  [references/verification.md](references/verification.md) and use Lynx
  DevTool/official device diagnostics instead of guessing from a bundle. Run
  `lynxship devtool doctor`, `lynxship trace doctor` or
  `lynxship recorder doctor` to verify the project-side prerequisites; the
  official DevTool Desktop application remains responsible for recording and
  analysis.

## Required validation before handoff

Run the smallest relevant checks first, then the repository checks:

```text
lynxship doctor --platform android|ios|harmony|web|desktop
lynxship autolink check --platform android|ios
lynxship ota doctor --platform android|ios
pnpm check
```

For a real native build, also verify that the produced artifact exists, has
the expected platform extension, and is cryptographically valid. A simulator
compile, unsigned artifact, local contract build, or Lynx Explorer preview
must be labelled as such and must not be reported as a store-ready artifact.

## References

- [Source verification and current-information policy](references/source-policy.md)
- [Lynx, Rspeedy, Explorer, DevTool, Autolink, and native API map](references/lynx-platforms.md)
- [Android/iOS host integration and platform boundaries](references/native-integration.md)
- [Testing, runtime fingerprints, OTA compatibility, and diagnostics](references/verification.md)
