# CLI design system

The CLI follows the terminal-first LynxShip identity defined in the normative specification. The visual layer is isolated in `packages/cli/src/ui` so command logic does not duplicate formatting rules.

## Command surface

The published executable is installed with `npm install --global
@lynxship/cli` and is invoked as `lynxship`. The complete operational surface
is:

```text
init                         Initialize or link a project
doctor                       Check the local toolchain and project
dev / preview                Run or preview Rspeedy
inspect / profile            Inspect or profile Rspeedy configuration
autolink check               Check native-library wiring
autolink codegen             Run native-module codegen
ota doctor                   Check native OTA host integration
build create                 Build, sign and upload an artifact
build all                    Build Android and iOS on macOS
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

`lynxship build --no-upload` is intended for CI toolchain verification. It
performs the real native build and signature verification, keeps the UUID-named
artifact locally, and skips only the Cloudflare R2 transfer. Android builds are
allowed on Linux, macOS and Windows; iOS builds are allowed only on macOS.

`lynxship build --platform all` creates and runs both native builds
concurrently after producing one shared Lynx bundle. Each platform has an
independent job, progress stream and artifact. A real local all-platform build
requires macOS, an Android host and an iOS Xcode host; Windows and Linux remain
valid for Android-only builds.

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
