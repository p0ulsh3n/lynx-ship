# LynxShip

Build, sign, store, submit and update LynxJS applications from your terminal.

LynxShip is a terminal-first release toolchain for LynxJS. It connects the
Rspeedy bundle to Android Gradle, Apple Xcode, the official HarmonyOS host,
Rspeedy Web or Lynxtron Desktop packaging, then handles Cloudflare R2
artifacts, store submission and signed OTA updates in one explicit workflow.

> LynxShip never fabricates a platform artifact. Android/iOS/HarmonyOS require
> their official hosts and signing contracts; Web/Desktop require their
> official packaging configuration. Store submission still requires the
> developer's own Apple or Google accounts and the stores' review steps.

[Documentation](docs/) · [CLI design system](docs/cli.md) · [Operations](docs/operations.md) · [Compatibility](docs/compatibility.md)

## Contributor skills

Repository skills are versioned under [`.agents/skills`](.agents/skills). They
are part of the engineering contract for contributors and coding agents:

- [`lynxship-lynx-engineering`](.agents/skills/lynxship-lynx-engineering/SKILL.md)
  covers current Lynx/Rspeedy APIs, native hosts, Autolink, modules, DevTool
  and runtime verification.
- [`lynxship-cli-release`](.agents/skills/lynxship-cli-release/SKILL.md)
  covers CLI commands, build state, credentials, R2, signing, OTA, store
  submission, CI and npm release verification.
- [`lynxship-platform-engineering`](.agents/skills/lynxship-platform-engineering/SKILL.md)
  covers the API, contracts, auth, tenants, PostgreSQL, Redis queues, R2,
  workers, dashboard, telemetry, webhooks and platform security.

Before changing a framework-facing integration, the relevant skill's
source-policy reference must be checked against the current official docs,
installed packages and upstream release source.

Skills are versioned engineering instructions, not live documentation and
cannot guarantee future compatibility by themselves. Their source policies
require an official-docs and lockfile review whenever a framework, provider or
runtime version changes. A scheduled link audit catches dead sources; it does
not replace semantic migration review.

## Quick start

### Install the published CLI

Install the published CLI from npm:

```bash
npm install --global @lynxship/cli@latest
lynxship --help
```

Or run it without a global install:

```bash
npx @lynxship/cli doctor --project-dir ./my-lynx-app
```

### Initialize a LynxJS project

```bash
cd ./my-lynx-app
lynxship init
```

The build command also initializes **lynxship.json** automatically when it
detects a LynxJS project that has not been initialized yet. Initialization
generates one stable UUID project ID for that project.

For CI toolchain verification without Cloudflare credentials, pass
`--no-upload`. LynxShip still performs the real bundle, Gradle and signing
steps, stores the UUID-named artifact in `.lynxship/artifacts`, and skips only
the R2 upload:

```bash
lynxship build --project-dir ./my-lynx-app --platform android \
  --profile production --no-upload --non-interactive
```

### Configure the machine once

```bash
lynxship storage configure
lynxship android configure
lynxship store configure --platform android
```

The first command connects LynxShip to Cloudflare R2. The second loads an
existing Android keystore or creates a development keystore. The third loads
Google Play or App Store Connect submission credentials. Secret inputs are
hidden and credentials are stored outside the project configuration.

### Build a signed Android artifact

```bash
lynxship doctor --platform android
lynxship build --platform android --profile production
```

The real Android path is:

```text
Rspeedy bundle
  -> Android asset synchronization
  -> Android SDK and Gradle
  -> release APK or AAB
  -> signature verification
  -> UUID artifact name
  -> Cloudflare R2 upload
  -> expiring download URL and terminal QR code
```

### Submit the latest successful build

```bash
lynxship submit --platform android --latest
```

When using the self-hosted control plane, start it separately and point the
CLI at it:

```powershell
$env:LYNXSHIP_API_URL = "http://127.0.0.1:8787"
lynxship submit --platform android --latest
```

Unix shells:

```bash
export LYNXSHIP_API_URL=http://127.0.0.1:8787
lynxship submit --platform android --latest
```

Installing the npm package does not start Docker and does not create cloud
resources automatically. Run `lynxship self-host init` and `docker compose up
-d` only when you operate the self-hosted API yourself.

## What LynxShip does

- **Build** LynxJS bundles with the project's Rspeedy configuration.
- **Compile** real Android releases with the Android SDK, Gradle and the
  configured signing identity.
- **Compile** real iOS releases with Xcode on macOS.
- **Store** immutable APK, AAB, IPA and OTA assets in Cloudflare R2.
- **Submit** Android artifacts to Google Play and iOS artifacts to App Store
  Connect using configured provider credentials.
- **Update** JavaScript and asset bundles through signed OTA releases.
- **Protect OTA compatibility** by blocking publication after native runtime
  inputs change until a new binary build exists.
- **Install and inspect** artifacts on Android devices, iOS simulators and
  iOS devices.
- **Check Lynx native libraries** through Autolink inspection and codegen.
- **Run locally or self-host** the control plane with PostgreSQL, Redis and
  Cloudflare R2.

## Requirements

- Node.js 22 or 24 LTS, or Node.js 26 Current.
- Node.js 24 LTS is the recommended production baseline.
- pnpm 11, as pinned in **package.json**.
- Git.
- Android builds on Windows, macOS or Linux: JDK 17, Android SDK command-line
  tools, **adb**, Android platform/build tools and an executable project Gradle
  wrapper (`chmod +x android/gradlew` on Linux/macOS when needed).
- macOS can build both Android and iOS. Windows and Linux can build Android;
  iOS builds are restricted to macOS with Xcode.
- iOS builds: macOS, Xcode, Xcode command-line tools and valid Apple signing
  configuration.
- Store submission: a Google Play Developer account or an App Store Connect
  account with the required permissions.

```bash
node --version
pnpm --version
lynxship doctor --project-dir ./examples/lynx-android-demo --platform android
```

`doctor --platform android` reads the Android project's own Gradle Wrapper,
Android Gradle Plugin, `compileSdk` and `buildToolsVersion`. It then checks the
JDK, Android SDK location, required SDK packages, `adb`, `apksigner` and SDK
licenses. A global Gradle installation is not required: the project's
`android/gradlew` (or `gradlew.bat`) is always used.

```bash
lynxship doctor --project-dir ./my-lynx-app --platform android --fix
```

`--fix` is an interactive, consent-based repair. It can install missing SDK
packages with the detected `sdkmanager` and then offer to accept licenses. It
does not download Android Studio, change `build.gradle`, replace a Gradle
Wrapper, install a JDK, or alter signing credentials. Those changes affect the
machine or the project and are shown as an exact repair instruction instead.

## Configuration

### Project configuration

The init command creates a project-level **lynxship.json**. It contains project
policy, such as build profiles and OTA settings:

```json
{
  "projectId": "<generated-uuid>",
  "build": {
    "production": {
      "android": {
        "artifact": "apk"
      }
    }
  },
  "update": {
    "protocolVersion": 1,
    "channel": "production"
  }
}
```

`lynxship init` generates a stable UUID for `projectId`. It is the identity
of this project in LynxShip; it is not a placeholder and must not change after
the project has been connected to remote builds or OTA releases.

Credentials are not placed in this file. Project state, local artifacts and
build history are kept in the ignored **.lynxship/** directory.

### Machine configuration

R2, signing and store credentials are machine-global:

```text
Windows  %APPDATA%/LynxShip
macOS    ~/Library/Application Support/LynxShip
Linux    $XDG_CONFIG_HOME/lynxship or ~/.config/lynxship
```

The storage layer uses Windows DPAPI, macOS Keychain, and the Linux Secret
Service (`secret-tool`) when available. Headless Linux machines without a
Secret Service use an owner-only mode-600 fallback file; CI should inject
credentials through a secret manager or environment variables instead of
copying a developer profile.

### Cloudflare R2

```bash
lynxship storage configure
```

The wizard asks for the Cloudflare account ID, R2 bucket, R2 access key ID,
secret access key and signed-download URL lifetime. Secret fields are hidden.
Use an R2 token scoped to the required bucket; do not use a global Cloudflare
API token. MinIO is not required by the current Docker profile.

### Android signing

```bash
lynxship android configure
```

An existing **.jks** or **.keystore** is supported. This preserves the signing
identity of an application migrated from another framework. Leaving the path
empty creates a development keystore; use a company-controlled production
keystore for store releases.

### Create an Android host for a pure Lynx project

If the project contains only the Rspeedy bundle, create the native host
explicitly:

```bash
lynxship android host init --application-id com.example.myapp
```

The command refuses to overwrite an existing `android/` directory. It creates
a minimal Android Gradle application using Lynx's official embedding APIs,
including `LynxEnv`, `LynxView`, a template provider and the Gradle wrapper.
Use the real application ID when migrating an existing app; the generated
`com.example.*` value is suitable only as a development default. The template
does not generate store certificates, custom permissions, native modules or
OTA provider logic; those are application-specific and must be integrated
explicitly.

When an interactive real `build` detects that the platform directory is
absent, it asks for the application identifier and creates this host before
continuing. In CI or `--non-interactive` mode, pass `--application-id` or
`--bundle-identifier`. An existing but incomplete `android/` or `ios/`
directory is never overwritten.

### Create an iOS host for a pure Lynx project

On macOS, a pure Rspeedy project can receive the same native host bootstrap:

```bash
lynxship ios host init --bundle-identifier com.example.myapp
```

This command never overwrites an existing `ios/` directory. It creates an
official Lynx CocoaPods/Xcode host with `LynxEnv`, `LynxView`, the Swift bundle
provider, `Podfile`, `ExportOptions.plist` and the bundle synchronization
script. If `lynxship.json` already exists, the generated project, scheme and
bundle paths are added to its production profile.

```bash
lynxship doctor --platform ios
lynxship build --platform ios --profile production
```

Before an iOS build, `lynxship doctor --platform ios` checks macOS, the active
Xcode developer directory, Xcode/`xcodebuild`, `xcrun`, `codesign`, `unzip`, the
Xcode host and scheme, build settings, Apple team, signing identity, CocoaPods
when `ios/Podfile` exists, export method, and provisioning profile validity.
It never prints certificate or profile contents. On a Mac, Xcode contains
`xcodebuild` and `xcrun`; the standalone Command Line Tools package alone is
not sufficient for an Xcode archive.

The first real build installs CocoaPods dependencies automatically. Xcode,
CocoaPods and real Apple signing credentials are still required for a signed
IPA; LynxShip never invents Apple certificates or provisioning profiles.

At build time, LynxShip applies those machine credentials through a temporary
Gradle init script. It does not rewrite `build.gradle`, `build.gradle.kts`,
`settings.gradle` or any other project file. For standard Android Gradle Plugin
projects, the adapter uses the official Android Components `finalizeDsl` hook,
reuses the existing `release` signing configuration when present, and attaches
it to the `release` build type before Gradle creates the release tasks. The
temporary script is removed after the build, including after a failure.

This automatic path requires an Android application module with a `release`
build type and a normal Android Gradle Plugin signing DSL. A custom build
system, a flavor-only release task, or a proprietary signing plugin that ignores
the Android signing DSL still needs explicit project integration; LynxShip
reports that limitation instead of pretending the artifact is signed.

### Google Play submission

```bash
lynxship store configure --platform android
```

The wizard accepts a Google service-account JSON file, Android application ID,
Play track and release status. The service account must be created by the
application owner and granted only the permissions required for the target
application in Google Play Console. The JSON is encrypted locally and must not
be committed.

### App Store Connect submission

```bash
lynxship store configure --platform ios
```

The wizard accepts the App Store Connect API key ID, issuer ID, bundle ID,
optional App Store Connect app ID, **.p8** private key path and optional Apple
Transporter path.

This configures store submission. iOS binary signing is configured separately
through Xcode, the Apple Distribution certificate, the provisioning profile
and the profile's export options.

## CLI workflow

```text
init -> doctor -> autolink check -> ota doctor -> build
     -> run / logs -> submit -> update -> rollback (if needed)
```

## Command reference

### Project and environment

```bash
lynxship init --project-dir <path> [--project-id <id>]
lynxship doctor --project-dir <path> --platform android
lynxship doctor --project-dir <path> --platform ios
```

**init** creates the project configuration and state directory. It does not
install dependencies, create store accounts or generate production keys.

**doctor** checks Node, lockfiles, project configuration, R2, signing or Xcode,
Lynx Autolink and the platform toolchain. On Android it validates the project
AGP/Gradle compatibility instead of guessing a global Gradle version. It
reports problems but does not rewrite native host files. Add `--fix` to offer
the safe SDK-package repair described above.

Recoverable CLI errors include a `Next steps` section with the commands needed
to resolve them. For example, a pure Lynx project without an Android host will
show `lynxship dev` for Lynx Explorer, then
`lynxship android host init --application-id com.example.myapp` for a real
APK/AAB, followed by `lynxship doctor` and `lynxship build`. With `--json`, the
same commands are returned in the `nextSteps` array for CI automation.

### Local Lynx development

```bash
lynxship dev --project-dir <path>
lynxship preview --project-dir <path>
lynxship inspect --project-dir <path>
lynxship profile --project-dir <path>
```

- **dev** starts the Rspeedy development server.
- **preview** previews the production bundle locally.
- **inspect** inspects Rspeedy/Rspack configuration.
- **profile** runs a build with Rspack profiling enabled.

### Lynx DevTool, Trace and Recorder

```bash
lynxship devtool doctor --platform android
lynxship trace doctor --platform android
lynxship recorder doctor --platform android
```

These commands verify the Rspeedy development script, the native host's
development runtime, Trace/DevTool dependencies and device transport. They do
not replace the official Lynx DevTool Desktop application. Lynx's release
runtime intentionally excludes Trace and Recorder; use the matching `-dev`
Lynx, Trace and DevTool dependencies, then connect the target by USB.

`lynxship dev` is intentionally available even when the project has no
`android/` or `ios/` directory. It starts the official Rspeedy development
server; scan its QR code with Lynx Explorer to see the screen on a device and
receive live source updates. This is the correct workflow for a pure
`create-rspeedy` project.

An APK/AAB is a different workflow. Lynx's production integration requires a
native Android host that initializes Lynx, creates a `LynxView`, provides a
bundle/resource loader and owns the Android Gradle project. LynxShip creates a
missing minimal host only after collecting the application identifier; it does
not overwrite or guess an existing native application.

### Native Lynx integration

```bash
lynxship autolink check --platform android
lynxship autolink check --platform ios
lynxship autolink codegen --library-dir <native-library>
lynxship ota doctor --platform android
lynxship ota doctor --platform ios
```

**autolink check** verifies native host integration, manifest paths, Android
package names, iOS podspecs and duplicate annotated capabilities when they are
discoverable from native source. **autolink codegen** runs the library's
official **codegen** package script and can generate native module files.
**ota doctor** checks the native hooks required for signed OTA download,
activation, fallback and rollback.

### Build

```bash
lynxship build --project-dir <path> --platform android --profile production
lynxship build create --project-dir <path> --platform android --profile production
lynxship build --project-dir <path> --platform all --profile production
lynxship build all --project-dir <path> --profile production
```

Creates a build job and, when a supported local host exists, executes the real
Rspeedy, Gradle or Xcode pipeline. The artifact is verified, assigned a UUID
filename and uploaded to R2.

`--platform all` (or `lynxship build all`) builds Android, iOS, HarmonyOS, Web
and Desktop concurrently after one shared Lynx bundle step. Each target has
its own build job, progress events and UUID-named artifact. A complete real
all-platform build requires macOS for iOS and the official Harmony and
Lynxtron hosts; Windows and Linux can run supported targets individually.
Missing hosts or SDKs fail clearly instead of producing placeholder artifacts.

```bash
lynxship build list
lynxship build status <build-id>
lynxship build cancel <build-id>
lynxship build retry <build-id>
```

Use **--no-wait** when a separate worker is responsible for executing the job.
Use **--local** only for local contract paths, never for a production store
build.

### Install and logs

```bash
lynxship run --platform android [--artifact <apk>] [--device <id>]
lynxship run --platform ios --simulator --artifact <app> [--device <id>]
lynxship run --platform ios --artifact <ipa> --device <id>
lynxship logs --platform android [--device <id>]
lynxship logs --platform ios --device <simulator-id>
```

**run** installs the latest successful artifact, or the explicitly supplied
artifact. Android uses **adb**. iOS uses **xcrun simctl** for simulators and
**xcrun devicectl** for physical devices. **logs** streams native logs and
stops with Ctrl+C.

### Store submission

```bash
lynxship submit --project-dir <path> --platform android --latest
lynxship submit --project-dir <path> --platform ios --latest
```

Requires a successful signed build, R2 configuration and matching store
credentials. Google Play uses its publishing API; iOS uses Apple Transporter.
Store review and processing remain controlled by Google and Apple.

**--local** enables mock submission tests only. It never uploads to a real
store.

### OTA update

```bash
lynxship update --project-dir <path> --platform android --bundle dist/main.lynx.bundle --message "Fix checkout"
```

Uploads the selected Lynx bundle, or the default **dist/\*.lynx.bundle** assets,
to R2, signs the release manifest and publishes it through the LynxShip API.

The runtime fingerprint includes the package lockfile, Lynx versions, native
Android/iOS sources, build configuration and native-library manifests. Native
changes block OTA publication with **OTA_NATIVE_CHANGE_REQUIRED**. Build and
submit a new binary before publishing the update.

For an iOS deployment requiring an approval identifier:

```bash
lynxship update --platform ios --bundle dist/main.lynx.bundle --policy-approval-id <approval-id>
```

To restore a previously published compatible OTA release without deleting
the bad release or its artifact:

```bash
lynxship update rollback --platform android --release-id <release-id> --reason "Stop checkout crash"
lynxship update rollback --platform ios --release-id <release-id> --reason "Restore known-good release"
```

The rollback changes the selected channel's current release and records the
reason in the control plane. It does not undo native Android/iOS code; native
changes still require a new binary build and store submission. Use
`--local` only to exercise the local contract path.

`lynxship rollback ...` is retained as a compatibility alias for
`lynxship update rollback ...`.

### Self-hosting and setup

```bash
lynxship self-host init --project-dir <path>
lynxship storage configure
lynxship android configure
lynxship store configure --platform android
lynxship store configure --platform ios
```

**self-host init** creates protected local self-host credentials but does not
start Docker. The current profile uses PostgreSQL for control-plane data, Redis
for durable queue state and Cloudflare R2 for artifact bytes.

## OTA compatibility model

OTA is for JavaScript and asset changes compatible with the installed native
runtime. The native clients verify signed manifests and asset hashes, keep the
embedded bundle as fallback, activate updates atomically, mark a launch
successful after the first screen and roll back after repeated failures.

## Web, HarmonyOS and Desktop builds

LynxShip has real adapters for the three additional Lynx targets, but each one
uses the official project integration rather than a generated placeholder:

```bash
lynxship doctor --platform web
lynxship build --platform web --profile production --no-upload

lynxship doctor --platform harmony
lynxship build --platform harmony --profile production --no-upload

lynxship doctor --platform desktop
lynxship build --platform desktop --profile production --no-upload
```

Web requires the Rspeedy `web` environment or a project `build:web` script and
verifies one `*.web.bundle` in `dist/`, `build/web/` or `build/` (or the
profile's explicit artifact path).
HarmonyOS requires the official Lynx `harmony/` host, `ohpm`, its pinned
`hvigorw` wrapper, release signing and the official HAP `verify-app` check.
Desktop requires Lynxtron/`lynxtron-builder`, or a project Electron Builder
host with `pack`, `build:desktop` or `build:app`. The adapter discovers
distributables in the common Electron Builder output directories. The
resulting artifacts are copied to UUID-named local paths and can be uploaded
to R2. On Windows, LynxShip verifies the Authenticode signature on the final
`.exe`; on macOS it verifies the Apple code signature when the artifact exposes
an app bundle. Production or uploaded Desktop builds stop if that verification
fails. Configure Electron Builder with `WIN_CSC_LINK`/`CSC_LINK` and the
corresponding protected password, or with the target platform's signing
identity. For local packaging tests only, use `--allow-unsigned --no-upload`.

See the current official [Lynx Harmony integration](https://lynxjs.org/next/guide/start/integrate-with-existing-apps.html),
[Rspeedy Web integration](https://lynxjs.org/3.6/rspeedy/start/integrate-with-existing-apps),
[Lynxtron builder](https://lynxjs.org/next/lynxtron/api/%40lynx-js/lynxtron-builder/index.html)
and [OpenHarmony HAP signer](https://github.com/openharmony/developtools_hapsigner)
documentation before changing a target adapter.

## iOS builds

iOS production builds run only on macOS with Xcode. A production profile must
identify the workspace or project, scheme and export options:

For a pure Rspeedy project, generate that host and profile wiring with:

```bash
lynxship ios host init --bundle-identifier com.example.myapp
```

The generated host follows Lynx's official CocoaPods integration and the CLI
runs `pod install` before archiving. Apple certificates, provisioning
profiles, a Developer team and App Store Connect credentials remain required
for a signed or submitted IPA.

```json
{
  "build": {
    "production": {
      "ios": {
        "workspace": "ios/App.xcworkspace",
        "scheme": "App",
        "exportOptionsPlist": "ios/ExportOptions.plist",
        "bundleScript": "ios/sync-bundle.mjs"
      }
    }
  }
}
```

The iOS path runs Rspeedy, the optional bundle script, Xcode archive and
export, signature verification, UUID artifact naming and R2 upload. Windows
and Linux fail clearly instead of creating a fake iOS artifact.

## Linux notes

Linux is a supported host for the Android CLI path and for the self-hosted
control plane. Android's official `sdkmanager` supports headless Linux
installations, and Gradle recommends using the project's Gradle Wrapper with
JDK 17 or newer. Install the SDK command-line tools, accept the licenses, and
make sure `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) and `JAVA_HOME` are available
to the shell that runs LynxShip.

References: [Android command-line tools](https://developer.android.com/tools/sdkmanager),
[Android environment variables](https://developer.android.com/tools/variables),
[Gradle installation](https://docs.gradle.org/current/userguide/installation.html),
and [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/).

## Docker control plane

```bash
docker compose up -d
docker compose ps
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/ready
docker compose down
```

The API uses PostgreSQL and Redis. Artifact bytes are stored in Cloudflare R2;
MinIO is not part of this profile. Replace development credentials before
using Docker in a shared or production environment. Do not use
**docker compose down -v** unless deleting local volumes is intentional.

## CLI output

The terminal UI is implemented in **packages/cli/src/ui** and documented in
[docs/cli.md](docs/cli.md). It provides the Braille logo, semantic event
colors, a vertical **│** event journal, live progress bars, spinners, compact
summary boxes, small terminal QR codes and stable **--json** output.

**--quiet**, **--no-color**, **--non-interactive**, **CI=1** and **NO_COLOR**
are supported for automation.

## CI usage

CI should use a clean runner and inject secrets through its secret manager.
Do not copy a developer's machine credential directory into CI.

```bash
lynxship doctor --project-dir "$PROJECT_DIR" --json --non-interactive
lynxship build --project-dir "$PROJECT_DIR" --platform android --profile production --json --non-interactive
lynxship submit --project-dir "$PROJECT_DIR" --platform android --latest --json --non-interactive
```

Configure the package manager, Android SDK, Java, R2 and store credentials in
the runner environment or its native secret manager.

The repository workflow also runs an iOS job on a pinned GitHub-hosted
`macos-15` runner. It checks the Xcode toolchain, compiles the official
`HelloLynxSwift` simulator fixture, and verifies that a project without an iOS
native host fails with `IOS_HOST_REQUIRED` instead of producing a fake
artifact. A real signed IPA job additionally requires an iOS Xcode host, Apple
certificates/provisioning and protected App Store Connect credentials.

For GitHub Actions, store R2 values as repository secrets named
`LYNXSHIP_R2_ACCOUNT_ID`, `LYNXSHIP_R2_BUCKET`, `LYNXSHIP_R2_ACCESS_KEY_ID` and
`LYNXSHIP_R2_SECRET_ACCESS_KEY`. Never place the values directly in YAML; the
workflow has harmless test fallbacks when those secrets are not configured.

## Repository development

```bash
pnpm format
pnpm structure:fix
pnpm lint
pnpm test
pnpm typecheck
pnpm dashboard:build
pnpm check
pnpm verify
pnpm --filter @lynxship/cli build
```

Before pushing:

```bash
pnpm check
pnpm verify
git diff --check
git status --short --ignored
```

Never commit credentials, service-account JSON files, App Store Connect
private keys, keystores, passwords, secret **.env** files, **.lynxship/**,
generated artifacts, personal SDK paths or presigned R2 URLs.

## Publishing the CLI (maintainers)

End users install the already-published package with npm; they do not need
this repository. Maintainers publishing a new version should run:

```bash
npm login
pnpm --filter @lynxship/cli... build
cd packages/cli
npm pack --dry-run
cd ../..
pnpm publish -r --access public
```

The `@lynxship` scope must belong to the publishing npm account or
organization. Verify the published result with:

```bash
npm view @lynxship/cli version
npm install --global @lynxship/cli@latest
```

## Repository layout

```text
packages/cli                  Terminal CLI and release workflows
packages/api                  Fastify control-plane API
packages/dashboard            React/TanStack/Tailwind dashboard
packages/sdk-android          Android OTA client
packages/sdk-ios              iOS OTA client
packages/*                    Contracts, storage, queue, signing and workers
examples/lynx-android-demo    Real LynxJS Android integration
examples/lynx-basic-template Minimal LynxJS smoke-test template
compose.yaml                  PostgreSQL, Redis and API development profile
docs/                         Architecture, operations and acceptance docs
```

## Documentation

- [docs/architecture.md](docs/architecture.md): package and service
  boundaries.
- [docs/cli.md](docs/cli.md): terminal design system and output contract.
- [docs/operations.md](docs/operations.md): health, queue, artifacts and
  secret incident procedures.
- [docs/threat-model.md](docs/threat-model.md): credential and artifact
  handling assumptions.
- [docs/compatibility.md](docs/compatibility.md): runtime and OTA rules.
- [docs/status.md](docs/status.md): implemented, beta and planned areas.
- [docs/acceptance-matrix.md](docs/acceptance-matrix.md): verification
  evidence and remaining production gates.

## License

MIT. See **package.json** for package metadata.
