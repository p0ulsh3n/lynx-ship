# Release security and provider boundaries

## Credentials

Use the existing secure-store abstraction. On Windows use DPAPI-backed
storage; on macOS use Keychain; on Linux use Secret Service when available or
explicitly document the CI environment variable fallback. Never use a
project-relative credential file as the default global store.

Input rules:

- use hidden input for R2 secrets, keystore passwords, service-account private
  keys, App Store Connect private keys and any certificate material;
- redact values from progress events, JSON diagnostics and exception text;
- scope credentials to the provider/project operation and support revocation;
- use CI secret variables or the platform keychain, never source control;
- clean temporary keychain imports, `.p12` files, provisioning profiles and
  generated credential files after the build.

Official references:

- [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Apple code signing](https://developer.apple.com/support/code-signing/)
- [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [Google Play Developer API](https://developers.google.com/android-publisher)

## Cloudflare R2

R2 is the artifact store. Use the documented S3-compatible API and presigned
URLs:

- [R2 overview](https://developers.cloudflare.com/r2/)
- [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

Rules:

1. Validate account ID, bucket and credentials before accepting configuration.
2. Keep buckets private and use bounded presigned download lifetimes.
3. Bind artifact metadata to project ID, build ID, immutable key and SHA-256.
4. Verify the local hash equals the uploaded object hash.
5. Never print the full presigned URL in a persistent log; show it only in the
   intended final interactive result and keep JSON output machine-safe.
6. Never fall back to filesystem, memory or MinIO for the configured R2
   production profile.

## Android signing

Use the official Android signing model and compatibility matrix:

- [Android app signing](https://developer.android.com/studio/publish/app-signing)
- [AGP compatibility](https://developer.android.com/build/releases/about-agp)

The adapter may apply a temporary Gradle init script, but must not rewrite a
developer's build files. Verify the final APK/AAB with `apksigner` and record
the actual v1/v2/v3/v4 result. Do not call an unsigned `assembleRelease`
output production-ready.

## iOS signing and export

Use `xcodebuild archive` followed by `xcodebuild -exportArchive` with an
explicit `ExportOptions.plist`:

- [Xcode distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
- [Xcode build settings](https://developer.apple.com/documentation/xcode/build-settings-reference)

Real iOS builds require macOS/Xcode. Verify the exported app bundle with
`codesign --verify --deep --strict` and fail if the IPA is absent or unsigned.
Do not emulate an IPA on Windows or Linux.

## OTA

Sign canonical manifests and bind them to immutable artifact URLs and hashes.
Accept a candidate only when the installed runtime fingerprint and policy
allow it. Test rollback, expiry, invalid signatures and failed first launch.
Treat native runtime changes as a new binary release.
