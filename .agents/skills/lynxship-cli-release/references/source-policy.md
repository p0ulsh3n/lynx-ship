# Current-source policy for CLI and release work

The CLI crosses multiple release systems. Before changing one of them, use
the primary documentation below and verify the exact dependency version in
this checkout. Record important URLs and dates in the PR or handoff.

## Primary sources

### Lynx and the native hosts

- [Lynx](https://lynxjs.org/)
- [Rspeedy CLI](https://lynxjs.org/4.0/rspeedy/cli.html)
- [Rspeedy Web integration](https://lynxjs.org/3.6/rspeedy/start/integrate-with-existing-apps)
- [Lynx Harmony integration](https://lynxjs.org/next/guide/start/integrate-with-existing-apps.html)
- [Lynxtron](https://lynxjs.org/next/lynxtron/api/%40lynx-js/create-lynxtron/index.html)
- [Lynxtron builder](https://lynxjs.org/next/lynxtron/api/%40lynx-js/lynxtron-builder/index.html)
- [Android/iOS integration](https://lynxjs.org/guide/start/integrate-with-existing-apps.html)
- [Autolink](https://lynxjs.org/guide/autolink)
- [Official native integration demos](https://github.com/lynx-family/integrating-lynx-demo-projects)
- [OpenHarmony HAP signer](https://github.com/openharmony/developtools_hapsigner)

### Android and JavaScript toolchain

- [Android Gradle Plugin compatibility](https://developer.android.com/build/releases/about-agp)
- [Android app signing](https://developer.android.com/studio/publish/app-signing)
- [Gradle user manual](https://docs.gradle.org/current/userguide/userguide.html)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [pnpm documentation](https://pnpm.io/)
- [npm package publishing](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)

### Apple and CocoaPods

- [Apple code signing overview](https://developer.apple.com/support/code-signing/)
- [Xcode build settings reference](https://developer.apple.com/documentation/xcode/build-settings-reference)
- [Xcode archive/export workflow](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
- [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [CocoaPods](https://guides.cocoapods.org/)

### Artifact storage, CI and stores

- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [R2 S3-compatible API](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [GitHub Actions](https://docs.github.com/en/actions)
- [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Google Play Developer API](https://developers.google.com/android-publisher)
- [Google Play publishing](https://developer.android.com/distribute/best-practices/launch)

## Verification procedure

1. Identify the package, provider API, platform tool and version involved.
2. Read the current primary documentation and source implementation.
3. Check the installed lockfile and types; run the smallest executable smoke
   test that proves the contract.
4. Record whether the result is simulated, local-only, unsigned, signed,
   uploaded, or submitted. These are different claims.
5. If two official sources disagree, stop at the boundary and report the
   version conflict instead of making a broad compatibility guess.

Do not use credentials, private endpoints, undocumented provider APIs or
unbounded scraping to resolve uncertainty. Use public documented APIs and
redacted diagnostics.
