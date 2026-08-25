# @lynxship/cli

Build, sign, store, submit and update LynxJS applications from the terminal.

LynxShip connects a real Rspeedy bundle to the selected Lynx target, runs the
official target toolchain, verifies the artifact where the platform exposes an
official verifier, uploads immutable artifacts to Cloudflare R2 and exposes an
expiring download URL with a compact terminal QR code.

> LynxShip never fabricates a target artifact. Android and iOS require their
> native hosts; HarmonyOS requires the official Hvigor/DevEco host; Web and
> Desktop require the project's official Rspeedy/Lynxtron configuration.

## Install

```bash
npm install --global @lynxship/cli@latest
```

Or run it without a global install:

```bash
npx @lynxship/cli@latest doctor --project-dir ./my-lynx-app
```

The package exposes the `lynxship` executable.

## Vue Lynx projects

LynxShip supports projects created with the official Vue Lynx scaffold. Vue
Lynx is integrated through the project's Rspeedy configuration, so LynxShip
does not swap plugins or mutate `lynx.config.*`; it invokes the project's
package-manager `build` script and then passes the generated Lynx bundle to
the selected native or non-native target pipeline.

```bash
npm create vue-lynx@latest my-vue-lynx-app
cd my-vue-lynx-app
npm install
npx @lynxship/cli@latest init
npx @lynxship/cli@latest doctor
npx @lynxship/cli@latest build --platform android --profile production
```

For iOS Simulator on macOS:

```bash
npx @lynxship/cli@latest build --platform ios --simulator --no-upload
```

The CLI generator itself creates ReactLynx templates by default. Use the
official `create-vue-lynx` scaffold when Vue is required, then add LynxShip to
that existing project with `init`.

## Octane and Miso

LynxShip detects Octane and Miso projects without replacing their
project-owned configuration.

Octane uses the official `@octanejs/rspeedy-plugin`. The Lynx integration is
still early access and its Lynx packages are not currently published on npm,
so development validation must use the official Octane repository and its
pnpm workspace:

```bash
git clone https://github.com/octanejs/octane.git
cd octane
pnpm install --filter @octanejs/rspeedy-plugin... --frozen-lockfile
pnpm --filter @octanejs/rspeedy-plugin exec rspeedy dev \
  --root examples/gallery --environment lynx
```

Miso uses the official Haskell/Nix flake rather than an npm build script.
Install Nix and the project's Haskell toolchain, then let LynxShip use the
flake's `default`/`bundle` output or configure a project-specific output in
`lynxship.json`. Miso remains experimental; a successful bundle does not
prove a signed Android or iOS production build.

See the source-verified fixture notes in the repository's
`examples/lynx-octane-fixture` and `examples/miso-lynx-fixture` directories,
plus `docs/compatibility.md`.

## Requirements

- Node.js 22 or 24 LTS, or Node.js 26 Current; Node.js 24 LTS is the
  recommended production baseline.
- A LynxJS project using Rspeedy.
- Android builds on Windows, macOS or Linux: JDK 17, Android SDK command-line
  tools, `adb`, build tools and an executable project Gradle wrapper.
- iOS builds: macOS, Xcode and Xcode command-line tools.
- HarmonyOS builds: an official Lynx Harmony host, DevEco/OpenHarmony SDK,
  `ohpm`, the project `hvigorw` wrapper, Java and the official HAP signing tool.
- Web builds: the project's Web environment (`environments.web`) or an
  explicit `build:web` script that produces one `*.web.bundle` in `dist/`,
  `build/web/` or `build/`.
- Desktop builds: the official Lynxtron host/builder, or an Electron Builder
  host with `pack`, `build:desktop` or `build:app`, on a supported target OS.
- Cloudflare R2 credentials for artifact storage.

After a native host exists, inspect and repair the Android toolchain with:

```bash
lynxship doctor --project-dir ./my-lynx-app --platform android
lynxship doctor --project-dir ./my-lynx-app --platform android --fix
```

The Android doctor reads the project's wrapper and Android Gradle Plugin before
checking Java, the SDK path, `compileSdk`, Build Tools, `adb`, `apksigner` and
licenses. The wrapper is authoritative; a machine-wide Gradle installation is
not required. `--fix` may install missing SDK packages with `sdkmanager` only
after confirmation. It never silently installs Android Studio or a JDK, edits
Gradle files, changes the wrapper or touches signing credentials.

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
devtool doctor       Check Lynx DevTool and development runtime
trace doctor         Check Lynx Trace prerequisites
recorder doctor      Check Lynx Recorder prerequisites
build create         Build, sign and upload an artifact
build all            Build Android, iOS, HarmonyOS, Web and Desktop
build list           List build jobs
build status <id>    Inspect one build job
build cancel <id>    Cancel a build job
build retry <id>     Retry a failed build job
submit               Submit the latest successful artifact
update               Publish a signed OTA update
update rollback      Roll back an OTA channel to a previous release
rollback             Compatibility alias for update rollback
run                  Install an Android, iOS or HarmonyOS artifact
logs                 Stream Android, iOS or HarmonyOS native logs
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
Rspeedy URLs are rendered by LynxShip's own compact QR adapter so the QR
remains visible when child-process output is captured. It uses the WISA
renderer settings (H-level correction, dots, dotted corners and 50-degree
linear gradient) with LynxShip pink-to-cyan colors and no center logo;
non-interactive output keeps the URL and omits terminal decoration. The Android
host command creates the native Gradle project needed for a real APK/AAB. An
interactive real build creates a missing host after asking for the application
ID; CI must pass `--application-id`. Existing native directories are never
overwritten. `--local` remains a contract-test mode and never creates a fake
artifact.

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

The same guidance covers missing R2 or signing setup, native SDK tools,
Autolink/codegen, target packaging, device tools, store credentials and OTA
compatibility. In automation, use `--json`; failures include a machine-readable
`nextSteps` array and optional `note` field.

## Web, HarmonyOS and Desktop targets

These adapters use existing official host contracts; they do not generate a
fictional native runtime.

### Web

Configure Rspeedy with the official Web environment and build the Web bundle:

```json
{
  "build": {
    "production": {
      "web": {
        "environment": "web",
        "artifact": "dist/main.web.bundle"
      }
    }
  }
}
```

```bash
lynxship doctor --platform web
lynxship build --platform web --profile production
```

The adapter invokes the profile's `web.script`, then an existing project
`build:web` script, and only otherwise uses `rspeedy build --environment web`.
It then requires exactly one Web bundle output unless the profile declares an
explicit artifact path.

### HarmonyOS

Use the official Lynx Harmony integration under `harmony/`. The project must
provide `hvigorw`, `hvigorfile.ts`, `build-profile.json5` and
`oh-package.json5`. LynxShip runs `ohpm install`, the pinned wrapper in release
mode, then verifies the signed HAP with the official `hap-sign-tool.jar`.
Before Hvigor runs, it copies root `.lynx.bundle` files plus `dist/static` and
`dist/async` into the configured HarmonyOS `rawfile` directory. This keeps
imported images and lazy bundles inside the HAP instead of leaving them only in
the JavaScript build output.

Optional profile overrides are explicit and remain project-owned:

```json
{
  "build": {
    "production": {
      "harmony": {
        "mode": "module",
        "product": "default",
        "module": "entry@default",
        "buildMode": "release",
        "task": "assembleHap"
      }
    }
  }
}
```

```bash
lynxship doctor --platform harmony
lynxship build --platform harmony --profile production --no-upload
lynxship run --platform harmony --artifact .lynxship/artifacts/<uuid>.hap
lynxship logs --platform harmony --device <device-id>
```

Set `LYNXSHIP_HAP_SIGN_TOOL` or `build.<profile>.harmony.signTool`; HAP signing
keys and profiles remain owned by the Harmony project and are never generated
or printed by LynxShip.

### Desktop

Use the official Lynxtron host and builder, or an Electron Builder host. The
adapter invokes the configured `desktop.script`, then `pack`, `build:desktop`,
or `build:app`, and otherwise runs `lynxtron-builder --publish never`. It then
requires one distributable such as `.dmg`, `.exe`, `.appimage` or `.zip`.

```json
{
  "build": {
    "production": {
      "desktop": {
        "script": "pack"
      }
    }
  }
}
```

```bash
lynxship doctor --platform desktop
lynxship build --platform desktop --profile production --no-upload
```

Desktop signing is checked before and after packaging. Windows builds require
a valid Authenticode signature; macOS builds require a valid Apple code
signature when the artifact exposes an app bundle. Configure the Lynxtron/
`electron-builder` signing inputs (`WIN_CSC_LINK`/`CSC_LINK`, protected
passwords, or the platform identity). Production and uploaded artifacts stop
when verification fails. Use `--allow-unsigned --no-upload` only for local
packaging tests.

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
and contains the Gradle wrapper. `lynxship build` creates the host when
`android/` is absent, or fails with a repair instruction when an existing host
is incomplete; `--local` only tests LynxShip's contract state machine and never
fabricates an APK.

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

If the project already has its app icon, provide the required high-resolution
PNG during host creation:

```bash
lynxship ios host init --bundle-identifier com.example.myapp --icon ./assets/icon.png
```

The icon must be a square 1024x1024 PNG. For an existing host, set
`build.production.ios.appIcon` in `lynxship.json`, or add `icon.png` in the
project root; LynxShip discovers it before the next native build. Simulator
builds may fall back to a square `lynx-logo*.png` emitted by Rspeedy for local
preview only; provide the project icon for an IPA or store release.

The command refuses to overwrite an existing `ios/` directory and creates a
Swift host based on Lynx's official integration shape: `LynxEnv`, `LynxView`,
`LynxTemplateProvider`, `Podfile`, `ExportOptions.plist` and a bundle sync
script. On macOS, `lynxship build --platform ios` installs CocoaPods before
archiving. Xcode, CocoaPods and real Apple signing credentials are still
required for a signed IPA; the CLI never fabricates them.

For an iOS Simulator build, use the dedicated simulator profile:

```bash
lynxship doctor --project-dir ./my-lynx-app --platform ios --profile simulator
lynxship build --project-dir ./my-lynx-app --platform ios --simulator --profile simulator --no-upload
```

This uses Xcode's `iphonesimulator` SDK, boots an available Simulator, creates
and installs a local `.app`, opens the Simulator and launches the app in an
interactive terminal, and does not require a physical iPhone, Apple
Distribution certificate, provisioning profile or R2 upload. Use the
production profile only for a signed device IPA. Pass `--no-autostart` to
install without launching, or use `run --platform ios --simulator --launch
--artifact <app>` to launch an already-built app.

Rspeedy can emit external files beside the main bundle. The iOS adapter copies
all root `.lynx.bundle` files plus `dist/static` and `dist/async` into the
compiled `.app` before installation/export, so imported images and lazy assets
are included in Simulator and device builds. The same synchronization is
applied to older LynxShip-generated iOS hosts.

Run the complete first-use diagnosis before building:

```bash
lynxship doctor --project-dir ./my-lynx-app --platform ios
```

The iOS doctor checks the active macOS developer directory, Xcode and
`xcodebuild`, `xcrun`, `codesign`, IPA verification tools, the host and scheme,
Xcode build settings, Apple team, valid Apple Distribution/Development
identity, CocoaPods when a `Podfile` exists, export method and provisioning
profile validity. It does not print certificate or provisioning-profile
contents. Xcode-managed signing is reported as a warning when profiles are not
cached locally; manual signing without a valid matching profile fails before
the archive starts.

### Lynx DevTool, Trace and Recorder

```bash
lynxship devtool doctor --platform android
lynxship trace doctor --platform android
lynxship recorder doctor --platform android
```

These checks validate the project development script, native DevTool/Trace
dependencies and USB transport. Trace and Recorder require Lynx's matching
`-dev` runtime; the official Lynx DevTool Desktop application performs the
actual recording and analysis.

## Package layout

The CLI is backed by public `@lynxship/*` runtime packages in this workspace.
Their published versions may differ from the CLI version; workspace ranges are
rewritten to released versions when the package is packed. Publish a changed
runtime package before publishing the CLI when its source or version changed.

## License

MIT
