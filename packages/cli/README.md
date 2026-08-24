# @lynxship/cli

Build, sign, store, submit and update LynxJS applications from the terminal.

LynxShip connects a real Rspeedy bundle to the native Android or iOS build
toolchain, verifies the resulting signature, uploads immutable artifacts to
Cloudflare R2 and exposes an expiring download URL with a compact terminal QR
code.

> LynxShip is currently beta software. Android local builds are exercised
> end-to-end. iOS builds require macOS and Xcode. Store submission still uses
> the developer's own Google Play or App Store Connect credentials.

## Install

```bash
npm install --global @lynxship/cli
```

Or run it without a global install:

```bash
npx @lynxship/cli doctor --project-dir ./my-lynx-app
```

The package exposes the `lynxship` executable.

## Requirements

- Node.js 22 or 24 LTS, or Node.js 26 Current; Node.js 24 LTS is the
  recommended production baseline.
- A LynxJS project using Rspeedy.
- Android builds on Windows, macOS or Linux: JDK 17, Android SDK command-line
  tools, `adb`, build tools and an executable project Gradle wrapper.
- iOS builds: macOS, Xcode and Xcode command-line tools.
- Cloudflare R2 credentials for artifact storage.

## First configuration

Run these once on each development or CI machine:

```bash
lynxship storage configure
lynxship android configure
lynxship store configure --platform android
```

Secret inputs are hidden. Credentials are stored outside the project using the
OS-specific secure storage path. Linux uses Secret Service when `secret-tool`
is available and otherwise uses a mode-600 owner-only fallback suitable for
headless development; CI should use its secret manager or environment
variables. Credentials are never written to `lynxship.json`.

The project itself is initialized automatically by `build` when needed, or
explicitly with:

```bash
lynxship init --project-dir ./my-lynx-app
```

`init` writes a stable UUID `projectId` to `lynxship.json`. Each project gets
its own generated ID; credentials remain machine-global and are not written
to the project file.

## Build a signed Android artifact

```bash
lynxship build \
  --project-dir ./my-lynx-app \
  --platform android \
  --profile production
```

The interactive build journal follows the real pipeline:

```text
Rspeedy bundle
  -> Android asset synchronization
  -> Android SDK and Gradle
  -> release APK or AAB
  -> signature verification
  -> UUID artifact name
  -> Cloudflare R2 upload
  -> expiring download URL and QR code
```

CI can verify the complete local build without R2 credentials by adding
`--no-upload`. The signed artifact remains in `.lynxship/artifacts` and the
R2 transfer is the only skipped stage.

```bash
lynxship build --platform android --profile production --no-upload \
  --non-interactive
```

Progress percentages are shown only when LynxShip has a real measurement. Long
Rspeedy, Gradle and Xcode operations remain visible in the event journal until
their completion checkpoint is known; no timer-based percentage is invented.

### Project-safe Android signing

LynxShip does not require every project to contain a LynxShip-specific signing
helper. During a real Android build it creates a temporary Gradle init script,
passes it with Gradle's `--init-script` option, and removes it when the build
finishes. The script reads only the already configured machine credentials and
uses the Android Components `finalizeDsl` hook to configure the standard
`release` build type. The project's Gradle files are left unchanged.

This supports normal Android Gradle Plugin application projects using either
Groovy or Kotlin DSL. Projects with custom flavor tasks, non-standard signing
plugins, or no Android `release` build type must expose their signing contract
explicitly; LynxShip fails with a clear diagnostic rather than producing an
unverified artifact.

## Main commands

```text
init                 Initialize or link a project
doctor               Check the local toolchain and project
dev                  Run Rspeedy dev with Lynx Explorer QR/HMR
preview              Preview the production bundle locally
build create         Build, sign and upload an artifact
build all            Build Android and iOS on a macOS host
build list           List build jobs
build status <id>    Inspect one build job
build cancel <id>    Cancel a build job
build retry <id>     Retry a failed build job
submit               Submit the latest successful artifact
update               Publish a signed OTA update
update rollback      Roll back an OTA channel to a previous release
rollback             Compatibility alias for update rollback
run                  Install an artifact on a target
logs                 Stream native logs
autolink check       Check Lynx native-library wiring
autolink codegen     Run native-module codegen
ota doctor           Check native OTA host integration
storage configure   Configure Cloudflare R2
android host init   Create a minimal official Lynx Android host
android configure   Configure Android signing
store configure      Configure store submission credentials
```

Use `lynxship --help` or `lynxship <command> --help` for the complete option
list. `--json`, `--quiet`, `--no-color` and `--non-interactive` are available
for automation.

### Actionable error guidance

Recoverable errors print a `Next steps` section with the exact commands to
run. For example, a pure LynxJS project without a native Android host reports
the two supported paths instead of stopping at a generic Gradle error:

```text
x This project has no Android Gradle host...

Next steps
  1. lynxship dev
  2. lynxship android host init --application-id com.example.myapp
  3. lynxship doctor --platform android
  4. lynxship build --platform android --profile production
```

`lynxship dev` is for Lynx Explorer and live QR/HMR development. The Android
host command creates the native Gradle project needed for a real APK/AAB.
`--local` remains a contract-test mode and never creates a fake artifact.

To build both native platforms in one local workflow, use the multi-platform
selector:

```bash
lynxship build --platform all --profile production
# equivalent convenience form:
lynxship build all --profile production
```

This builds Android and iOS concurrently after one shared Lynx bundle step.
Their jobs, progress events and artifacts remain isolated. A real local `all`
build requires macOS, an Android host, an iOS Xcode host and the corresponding
signing setup. Windows and Linux can still run
`lynxship build --platform android`; use a macOS CI worker for the iOS half.
`--local` can exercise both contract paths without creating APK or IPA files.

The same guidance covers missing R2 or signing setup, Android SDK tools,
Autolink/codegen, iOS Xcode/CocoaPods, device tools, store credentials and
OTA compatibility. In automation, use `--json`; failures include a
machine-readable `nextSteps` array and optional `note` field.

## OTA rollback

```bash
lynxship update rollback \
  --platform android \
  --release-id <release-id> \
  --reason "Restore known-good release"
```

Rollback changes the current release pointer for the configured channel. It
does not delete the release or its R2 artifact, and it does not undo native
code. Native changes still require a new binary build and store submission.

## OTA safety

OTA updates are for JavaScript and assets compatible with the installed native
runtime. If native code, permissions, autolinked modules or other runtime
inputs change, LynxShip blocks the OTA and requires a new signed binary build.

## Linux host support

Android builds run on Windows, macOS and Linux, with device install/logs
through `adb` and the self-hosted control plane. Install the Android
command-line tools with `sdkmanager`, accept the required licenses, set
`ANDROID_HOME` or `ANDROID_SDK_ROOT` and `JAVA_HOME`, and ensure
`android/gradlew` is executable. macOS can build both Android and iOS; Windows
and Linux can build Android only.

## Pure Lynx projects and Lynx Explorer

A standard Rspeedy project can be developed without a native Android host:

```bash
lynxship dev --project-dir ./my-lynx-app
```

Rspeedy serves the development bundle and prints the QR code. Scan it with the
official Lynx Explorer app; edits to the Lynx source are then reflected live.
This is the supported path for projects containing `src/` and `lynx.config.*`
but no `android/` directory.

Production APK/AAB builds require a native Android host. The host is the
Android application that initializes Lynx, creates `LynxView`, loads the bundle
and contains the Gradle wrapper. `lynxship build` detects that requirement and
fails clearly when `android/gradlew` is absent; `--local` only tests LynxShip's
contract state machine and never fabricates an APK.

To create a minimal host for a pure project:

```bash
lynxship android host init --application-id com.example.myapp
```

This command never overwrites an existing `android/` directory. It creates a
real Gradle application with the official Lynx Android dependencies,
`LynxEnv`, `LynxView`, a bundle loader and a Gradle wrapper. Replace the example
application ID before a store release and add any project-specific native
modules, permissions, services and OTA integration explicitly.

For a pure project that targets iOS, create the native Xcode/CocoaPods host
with:

```bash
lynxship ios host init --bundle-identifier com.example.myapp
```

The command refuses to overwrite an existing `ios/` directory and creates a
Swift host based on Lynx's official integration shape: `LynxEnv`, `LynxView`,
`LynxTemplateProvider`, `Podfile`, `ExportOptions.plist` and a bundle sync
script. On macOS, `lynxship build --platform ios` installs CocoaPods before
archiving. Xcode, CocoaPods and real Apple signing credentials are still
required for a signed IPA; the CLI never fabricates them.

## Package layout

The CLI is backed by the public `@lynxship/*` runtime packages in this
workspace. They are published with the same version and must be available in
the configured npm scope before installing the CLI package.

## License

MIT
