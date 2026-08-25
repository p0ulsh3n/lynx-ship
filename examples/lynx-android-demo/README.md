# LynxShip Android demo

Small Vanilla Lynx/Rspeedy app with a minimal native Android host used to
exercise the LynxShip Android build and submit flow.

## Local build

From the repository root:

```bash
pnpm --filter @lynxship/lynx-android-demo build
```

The native host is under `android/`. It embeds `dist/main.lynx.bundle` as an
Android asset and renders it with `LynxView`. The release build is signed with
a local test keystore; it is a real installable APK, but it is not a Google
Play production signing key.

The host also includes the LynxShip OTA client as a local Android library.
OTA is fail-closed until its non-secret public configuration is supplied as
Gradle properties or environment variables:

```powershell
$env:LYNXSHIP_OTA_ENDPOINT = "https://api.example.invalid"
$env:LYNXSHIP_OTA_PROJECT_ID = "lynxship_android_demo"
$env:LYNXSHIP_RUNTIME_VERSION = "fp-..."
$env:LYNXSHIP_OTA_PUBLIC_KEY_ID = "key-..."
$env:LYNXSHIP_OTA_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----..."
```

The client calls `beginLaunch()` before rendering, serves the active asset
through the Lynx template provider, stages signed updates for the next launch,
and calls `markLaunchSuccess()` from Lynx's first-screen callback. Native code
and permissions are never delivered through OTA.

## Android build

The project uses JDK 17, Android SDK API 35 and the Gradle 8.7 wrapper. Set the
Android and signing variables in the current shell, then run:

```powershell
$env:JAVA_HOME = "<path-to-jdk-17>"
$env:ANDROID_HOME = "<path-to-android-sdk>"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = "<path-to-gradle-cache>"
$env:LYNXSHIP_KEYSTORE_PATH = "<path-to-existing-keystore>"
$env:LYNXSHIP_KEY_ALIAS = "lynxship-demo"
$env:LYNXSHIP_KEYSTORE_PASSWORD = "<local-test-password>"
$env:LYNXSHIP_KEY_PASSWORD = "<local-test-password>"

pnpm android:release
```

The raw Gradle output is `android/app/build/outputs/apk/release/app-release.apk`.
When the build is run through LynxShip, that APK is verified, copied to a
UUID-named artifact path, and only that immutable artifact is uploaded to R2.
For the CLI flow, leaving the keystore path empty in `lynxship android
configure` generates a fresh local keystore automatically and stores its
password with the platform secure store. Use a real secret keystore and
password management for production signing.

## Real LynxShip CLI flow

When the `android/` host is present and R2 is configured, the CLI runs the real
integration path: Rspeedy, bundle sync, Gradle release build, Android signing,
R2 upload and artifact hash.
The build state is kept in this project's ignored `.lynxship` directory:

```bash
pnpm --dir ../.. --filter @lynxship/cli build
node ../../packages/cli/dist/index.js build --platform android --profile production
node ../../packages/cli/dist/index.js submit --platform android --latest
```

The CLI may be called from any directory by selecting the project explicitly:

```powershell
node ..\..\packages\cli\dist\index.js build --project-dir . --platform android --profile production
```

Alternatively set `LYNXSHIP_PROJECT_DIR` once in the shell. The CLI keeps R2
and signing credentials stored once in the machine-global LynxShip configuration.
The selected project keeps only its own build state and policy.

Use `--json` in CI. The project ID and Android artifact policy live in
`lynxship.json`. Configure secrets once from a real terminal; secret fields are
never echoed and are protected by Windows DPAPI, macOS Keychain or the Linux
owner-only fallback:

```powershell
lynxship storage configure
lynxship android configure
```

With the Compose API running, register the R2 artifact in LynxShip:

```powershell
$env:LYNXSHIP_API_URL = "http://127.0.0.1:8787"
node ../../packages/cli/dist/index.js submit --platform android --latest
```

The CLI creates or reuses the organization/project, registers immutable R2
metadata through `POST /v1/artifacts`, and creates the submission through
`POST /v1/submissions`. It then uploads the AAB to the configured Google Play
track through the Android Publisher API. A successful interactive build prints
a temporary R2 download URL and a QR code at the bottom of the terminal. Live
store validation still requires a real Play application and service account.
