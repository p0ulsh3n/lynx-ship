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

## Main commands

```text
init                 Initialize or link a project
doctor               Check the local toolchain and project
dev                  Run the Rspeedy development server
preview              Preview the production bundle locally
build create         Build, sign and upload an artifact
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
storage configure    Configure Cloudflare R2
android configure   Configure Android signing
store configure      Configure store submission credentials
```

Use `lynxship --help` or `lynxship <command> --help` for the complete option
list. `--json`, `--quiet`, `--no-color` and `--non-interactive` are available
for automation.

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

## Package layout

The CLI is backed by the public `@lynxship/*` runtime packages in this
workspace. They are published with the same version and must be available in
the configured npm scope before installing the CLI package.

## License

MIT
