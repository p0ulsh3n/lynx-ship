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

- Node.js 22 LTS or newer; Node.js 24 LTS is the recommended production
  baseline.
- A LynxJS project using Rspeedy.
- Android builds: JDK 17, Android SDK, `adb`, build tools and the project's
  Gradle wrapper.
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
OS-specific secure storage path. They are never written to `lynxship.json`.

The project itself is initialized automatically by `build` when needed, or
explicitly with:

```bash
lynxship init --project-dir ./my-lynx-app
```

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

Progress percentages are shown only when LynxShip has a real measurement. Long
Rspeedy, Gradle and Xcode operations remain visible in the event journal until
their completion checkpoint is known; no timer-based percentage is invented.

## Main commands

```text
init                 Initialize or link a project
doctor               Check the local toolchain and project
dev                  Run the Rspeedy development server
preview              Preview the production bundle locally
build                Build, sign and upload an artifact
submit               Submit the latest successful artifact
update               Publish a signed OTA update
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

## OTA safety

OTA updates are for JavaScript and assets compatible with the installed native
runtime. If native code, permissions, autolinked modules or other runtime
inputs change, LynxShip blocks the OTA and requires a new signed binary build.

## Package layout

The CLI is backed by the public `@lynxship/*` runtime packages in this
workspace. They are published with the same version and must be available in
the configured npm scope before installing the CLI package.

## License

MIT
