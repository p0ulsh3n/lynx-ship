# LynxShip

Build, sign, store, submit and update LynxJS applications from your terminal.

LynxShip is a terminal-first release toolchain for LynxJS. It connects the
Rspeedy bundle, Android Gradle or Apple Xcode, Cloudflare R2 artifacts, Google
Play, App Store Connect and signed OTA updates in one explicit workflow.

> LynxShip is currently a beta foundation. The Android local path is exercised
> end to end. iOS builds require macOS and Xcode. Store submission still
> requires the developer's own Apple or Google accounts and the stores' review
> and processing steps.

[Documentation](docs/) · [CLI design system](docs/cli.md) · [Operations](docs/operations.md) · [Compatibility](docs/compatibility.md)

## Quick start

### Install the published CLI

After the packages are published to npm, install the CLI globally:

```bash
npm install --global @lynxship/cli
lynxship --help
```

Or run it without a global install:

```bash
npx @lynxship/cli doctor --project-dir ./my-lynx-app
```

### Publish the workspace packages

The CLI depends on five public `@lynxship/*` runtime packages. From a
maintainer checkout, publish the public dependency graph together so pnpm
rewrites `workspace:*` to the released versions in each npm tarball:

```bash
npm login
pnpm --filter @lynxship/cli... build
pnpm publish -r --access public
```

Run `npm pack --dry-run` in `packages/cli` before publishing to inspect the
CLI tarball. Do not publish until the `lynxship` npm scope belongs to your
account or organization and the package metadata has been reviewed.

### Install and verify

```bash
pnpm install
pnpm check
pnpm verify
```

### Initialize a LynxJS project

```bash
node packages/cli/dist/index.js init --project-dir ./examples/lynx-android-demo
```

The build command also initializes **lynxship.json** automatically when it
detects a LynxJS project that has not been initialized yet.

### Configure the machine once

```bash
node packages/cli/dist/index.js storage configure
node packages/cli/dist/index.js android configure
node packages/cli/dist/index.js store configure --platform android
```

The first command connects LynxShip to Cloudflare R2. The second loads an
existing Android keystore or creates a development keystore. The third loads
Google Play or App Store Connect submission credentials. Secret inputs are
hidden and credentials are stored outside the project configuration.

### Build a signed Android artifact

```bash
node packages/cli/dist/index.js build --project-dir ./examples/lynx-android-demo --platform android --profile production
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
docker compose up -d
```

PowerShell:

```powershell
$env:LYNXSHIP_API_URL = "http://127.0.0.1:8787"; node packages/cli/dist/index.js submit --project-dir ./examples/lynx-android-demo --platform android --latest
```

Unix shells:

```bash
export LYNXSHIP_API_URL=http://127.0.0.1:8787
node packages/cli/dist/index.js submit --project-dir ./examples/lynx-android-demo --platform android --latest
```

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
- Android builds: JDK 17, Android SDK, **adb**, Android build tools and the
  project's Gradle wrapper.
- iOS builds: macOS, Xcode, Xcode command-line tools and valid Apple signing
  configuration.
- Store submission: a Google Play Developer account or an App Store Connect
  account with the required permissions.

```bash
node --version
pnpm --version
node packages/cli/dist/index.js doctor --project-dir ./examples/lynx-android-demo --platform android
```

## Configuration

### Project configuration

The init command creates a project-level **lynxship.json**. It contains project
policy, such as build profiles and OTA settings:

```json
{
  "projectId": "local_project",
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

Credentials are not placed in this file. Project state, local artifacts and
build history are kept in the ignored **.lynxship/** directory.

### Machine configuration

R2, signing and store credentials are machine-global:

```text
Windows  %APPDATA%/LynxShip
macOS    ~/Library/Application Support/LynxShip
Linux    $XDG_CONFIG_HOME/lynxship or ~/.config/lynxship
```

The storage layer uses Windows DPAPI, macOS Keychain and an owner-only Linux
fallback file. CI should inject credentials through a secret manager instead
of copying a developer profile.

### Cloudflare R2

```bash
node packages/cli/dist/index.js storage configure
```

The wizard asks for the Cloudflare account ID, R2 bucket, R2 access key ID,
secret access key and signed-download URL lifetime. Secret fields are hidden.
Use an R2 token scoped to the required bucket; do not use a global Cloudflare
API token. MinIO is not required by the current Docker profile.

### Android signing

```bash
node packages/cli/dist/index.js android configure
```

An existing **.jks** or **.keystore** is supported. This preserves the signing
identity of an application migrated from another framework. Leaving the path
empty creates a development keystore; use a company-controlled production
keystore for store releases.

### Google Play submission

```bash
node packages/cli/dist/index.js store configure --platform android
```

The wizard accepts a Google service-account JSON file, Android application ID,
Play track and release status. The service account must be created by the
application owner and granted only the permissions required for the target
application in Google Play Console. The JSON is encrypted locally and must not
be committed.

### App Store Connect submission

```bash
node packages/cli/dist/index.js store configure --platform ios
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
     -> run / logs -> submit -> update
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
and Lynx Autolink. It reports problems but does not rewrite native host files.

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

### Native Lynx integration

```bash
lynxship autolink check --platform android
lynxship autolink check --platform ios
lynxship autolink codegen --library-dir <native-library>
lynxship ota doctor --platform android
lynxship ota doctor --platform ios
```

**autolink check** verifies native host integration. **autolink codegen** runs
the library's official **codegen** package script and can generate native
module files. **ota doctor** checks the native hooks required for signed OTA
download, activation, fallback and rollback.

### Build

```bash
lynxship build --project-dir <path> --platform android --profile production
```

Creates a build job and, when a supported local host exists, executes the real
Rspeedy, Gradle or Xcode pipeline. The artifact is verified, assigned a UUID
filename and uploaded to R2.

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

## iOS builds

iOS production builds run only on macOS with Xcode. A production profile must
identify the workspace or project, scheme and export options:

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
