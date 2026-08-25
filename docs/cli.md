# CLI design system

The CLI follows the terminal-first LynxShip identity defined in the normative specification. The visual layer is isolated in `packages/cli/src/ui` so command logic does not duplicate formatting rules.

## Command surface

The published executable is installed with `npm install --global
@lynxship/cli@latest` and is invoked as `lynxship`. The complete operational surface
is:

```text
init                         Initialize or link a project
doctor                       Check the local toolchain and project
doctor --fix                 Install missing Android SDK packages after confirmation
dev / preview                Run or preview Rspeedy
inspect / profile            Inspect or profile Rspeedy configuration
devtool doctor               Check Lynx DevTool and development runtime
trace doctor                 Check Lynx Trace prerequisites
recorder doctor              Check Lynx Recorder prerequisites
autolink check               Check native-library wiring
autolink codegen             Run native-module codegen
plugin list                  List project plugin packages
plugin doctor                Validate plugin metadata without changing files
plugin apply                 Apply plugin configuration/native changes
plugin apply --dry-run       Preview plugin changes without writing files
ota doctor                   Check native OTA host integration
build create                 Build, sign and upload an artifact
build all                    Build Android, iOS, HarmonyOS, Web and Desktop
build list/status             Inspect build jobs
build cancel/retry            Manage a build job
run / logs                   Install an artifact or stream native logs
submit                       Submit the latest successful artifact
update                       Publish a signed OTA release
update rollback              Restore a previous compatible OTA release
self-host init               Create protected self-host credentials
storage configure            Configure Cloudflare R2
android configure            Configure Android signing
store configure              Configure Google Play or App Store Connect
```

`rollback` remains a compatibility alias for `update rollback`. Use
`lynxship --help` for the option-level reference. Installing the npm package
does not start Docker; self-host operators explicitly run `lynxship self-host
init` and `docker compose up -d`.

`lynxship doctor --platform android --fix` is an interactive repair command. It
uses the Android SDK's `sdkmanager` to install only project-required missing
packages after confirmation, then optionally accepts SDK licenses. It never
silently installs Android Studio/JDK or rewrites a project's Gradle files.

The doctor reads `android/gradle/wrapper/gradle-wrapper.properties` and the
project's AGP declaration. It checks the official AGP/Gradle minimum, so an
error such as AGP 8.7 with Gradle 8.7 points to the exact wrapper mismatch
instead of asking the developer to install an unrelated global Gradle.

On macOS, `lynxship doctor --platform ios` also checks the active Xcode
developer directory, Xcode/`xcodebuild`, `xcrun`, `codesign`, the Xcode host and
scheme, build settings, Apple signing identity, CocoaPods when a `Podfile`
exists, export options and provisioning profiles. It never prints private key,
certificate or profile contents. A manual signing configuration without a
valid matching profile fails before the archive; automatic Xcode signing is
reported as such and may obtain a profile during the build.

`lynxship build --no-upload` is intended for CI toolchain verification. It
performs the real native build and signature verification, keeps the UUID-named
artifact locally, and skips only the Cloudflare R2 transfer. Android builds are
allowed on Linux, macOS and Windows; iOS builds are allowed only on macOS.

For iOS Simulator builds, an interactive `lynxship build --platform ios
--simulator` installs the generated `.app`, opens Simulator and launches the
application automatically. Use `--no-autostart` to keep it installed without
launching, or `lynxship run --platform ios --simulator --launch --artifact
<app>` to launch an existing `.app`. The CLI reads `CFBundleIdentifier` from
the built app rather than guessing it.

Rspeedy externalizes imported files into `dist/static` and lazy bundles into
`dist/async`. The iOS adapter copies every root `.lynx.bundle`, `static` and
`async` directory into the compiled app bundle before Simulator installation
or IPA export. If the native app icon set is empty, configure a project-owned
1024x1024 PNG using `ios host init --icon ./assets/icon.png` or
`build.production.ios.appIcon`; the CLI validates the PNG instead of silently
shipping a blank Home Screen icon. For Simulator-only previews, a square
`lynx-logo*.png` in the Rspeedy output may be resized with Apple's `sips` tool
as a development fallback; distribution builds should provide the project's
own 1024x1024 icon.

During `lynxship dev`, Rspeedy's official QR plugin may print only the URL
because LynxShip captures the child-process output instead of giving Rspeedy
the terminal directly. LynxShip therefore renders its own compact QR from the
same URL, including custom schemas such as `lynx://`; JSON, quiet and explicit
non-interactive modes intentionally emit no QR. The renderer follows the QR
service configuration: H-level error correction, dots modules, dotted corner
markers, a 50-degree linear LynxShip pink-to-cyan gradient, and no center logo.
Terminals without Unicode/ANSI color support use the compact monochrome
fallback.

`lynxship build --platform all` creates one independent job per supported target
and runs the real adapters concurrently after the shared Lynx bundle stage.
Android and iOS use their native hosts; HarmonyOS uses the official Hvigor
host; Web uses the Rspeedy Web environment; Desktop uses Lynxtron. A real
all-platform build requires macOS because the iOS job requires Xcode. On
Windows or Linux, run the supported targets individually or use a macOS CI
worker for the complete set. Missing official host/configuration files fail
with target-specific repair commands; no fake artifact is created.

## Additional target adapters

```text
lynxship doctor --platform web
lynxship build --platform web --profile production

lynxship doctor --platform harmony
lynxship build --platform harmony --profile production
lynxship run --platform harmony --artifact <signed-hap>
lynxship logs --platform harmony --device <device-id>

lynxship doctor --platform desktop
lynxship build --platform desktop --profile production
```

Web requires `lynx.config.*` with the official `environments.web` setup or an
explicit `build:web` script and verifies `dist/*.web.bundle`. HarmonyOS
requires the official `harmony/` host, `ohpm`, the pinned `hvigorw` wrapper and
`hap-sign-tool.jar`; before Hvigor runs, the adapter copies root `.lynx.bundle`
files plus `dist/static` and `dist/async` into the configured HarmonyOS
`rawfile` directory. The HAP must be signed and pass the official `verify-app`
check. Desktop requires Lynxtron/electron-builder packaging and a
real `.dmg`, `.exe`, `.appimage` or `.zip` output. These adapters inspect and
use project-owned configuration instead of inventing native integrations. On
Windows, `doctor` checks for Authenticode signing input and the build verifies
the final `.exe`; macOS uses `codesign` verification when an app bundle is
available. Production or uploaded artifacts stop when signing cannot be
verified. `--allow-unsigned --no-upload` is reserved for local packaging tests.

## DevTool, Trace and Recorder

```text
lynxship devtool doctor --platform android
lynxship trace doctor --platform android
lynxship recorder doctor --platform android
```

These diagnostics verify the Rspeedy development script, the native DevTool,
Trace and Recorder dependencies and USB transport. They do not reimplement the
official Lynx DevTool Desktop application or undocumented CDP behavior. Lynx's
release runtime excludes Trace and Recorder, so the matching `-dev` runtime is
required for those workflows.

## Tokens

The LynxShip brand follows the Lynx community CLI visual language: a pink to
cyan gradient from `#ff6b9d` to `#45b7d1`. The gradient is used for the
Braille logo, section headers, prompts and primary completion surfaces. The
semantic tokens below keep build events readable and distinguishable.

| Token     | Color     | Use                                    |
| --------- | --------- | -------------------------------------- |
| `brand`   | gradient  | logo, headings, prompts and primary UI |
| `teal`    | `#45B7D1` | steps, progress and command names      |
| `tealDim` | `#2F91AB` | secondary accent                       |
| `blue`    | `#72C7DF` | flags, channels, informational values  |
| `orange`  | `#FF9A8B` | warnings and progress context          |
| `yellow`  | `#F6C15D` | warnings and pending states            |
| `red`     | `#FF6B7A` | errors and failures                    |
| `purple`  | `#C5A0FF` | IDs                                    |
| `green`   | `#58D6B4` | successful/stable states               |
| `text`    | `#F4F8FB` | primary text                           |
| `muted`   | `#91A8B8` | labels and secondary text              |
| `dim`     | `#526B7C` | separators and version text            |

## Components

Interactive output uses this rhythm:

```text
optional Braille banner
section header
log lines
summary box
final status line
```

The reusable components are `sectionHeader`, `log`, `summaryBox`, `createProgress`, `spin`, `pill` and `finalLine`. The banner is hardcoded in `ui/logo.ts` and contains no runtime image/conversion dependency.

Progress values are rendered with up to two decimal places. The build pipeline
only advances determinate progress at completed checkpoints and uses the
Cloudflare R2/S3-compatible HTTP upload progress events for artifact transfer.
When Rspeedy, Gradle or
Xcode does not expose a trustworthy total, the percentage stays blank while
the live event journal remains visible instead of inventing timer-based
progress.

Build event journal lines use semantic colors: commands are blue, LynxShip
steps are teal, successful tool output is green, warnings are yellow, errors
are red, and neutral compiler output uses the primary text color. The event
classifier stays in the presentation layer; build execution only emits plain
messages.

Event markers are intentionally text-based so they remain readable in CMD,
PowerShell, Unix terminals and CI logs without depending on emoji glyph
support. The journal uses `➜` for commands, `-` for steps, `◆` for successful
checkpoints, `!` for warnings, `x` for errors and `│` only for technical log
output. Bracketed event labels are not printed because the marker already
defines the event type. Consecutive log lines have one small blank line
between them to keep the vertical rail visually breathable; steps and errors
stay compact.

## TTY, CI and JSON

- Decorations are enabled only on an interactive TTY.
- `--json`, `--quiet`, `--no-color`, `--non-interactive`, `CI=1` and `NO_COLOR` disable decorative output as appropriate.
- Progress bars and spinners never run in CI, JSON or non-TTY output.
- `--json` emits one stable JSON object on stdout; actionable errors include
  `error`, `code`, `nextSteps` and, when useful, `note`.
- Unicode icons have ASCII fallbacks.
- The CLI never prints a shell prompt.

## Actionable errors

The error renderer maps known recoverable conditions to concrete commands. A
missing Android host, for example, points to `lynxship dev` for Lynx Explorer,
`lynxship android host init --application-id ...` for a native host, then
`lynxship doctor` and `lynxship build` for the real APK/AAB path. The same
contract covers storage, signing, SDK tools, Autolink, Xcode/CocoaPods,
devices, stores and OTA compatibility. Unknown low-level errors retain their
original message and receive only safe generic guidance when the cause can be
recognized without guessing.

## Dependencies

The CLI uses only the presentation dependencies needed by the specification:

- `chalk` for exact ANSI colors;
- the ANSI-safe brand renderer for the Lynx brand gradient;
- `boxen` for width-aware summary boxes;
- `ora` for TTY-only spinners;
- `cli-progress` for TTY-only progress bars.

The command implementation remains explicit rather than hiding business behavior behind a large CLI framework.
