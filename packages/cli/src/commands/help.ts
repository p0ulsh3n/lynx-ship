export function helpText(): string {
  return `lynxship <command> [options]

Commands:
  init                    Initialize or link a LynxShip project
  doctor                  Check the local toolchain and project
  dev                     Run Rspeedy dev with Lynx Explorer QR/HMR
  preview                 Preview the production Lynx bundle locally
  inspect                 Inspect Rspeedy/Rspack configuration
  profile                 Build with Rspack profiling enabled
  devtool doctor          Check Lynx DevTool integration and dev runtime
  trace doctor            Check Lynx Trace prerequisites
  recorder doctor         Check Lynx Recorder prerequisites
  plugin list             List project plugins and their capabilities
  plugin doctor            Validate plugin packages without modifying native files
  plugin apply             Apply project plugin native changes for a platform
  plugin apply --dry-run   Preview plugin native changes without writing files
  autolink check          Check Lynx native-library Autolink wiring
  autolink codegen        Run the project's Native Module codegen script
  ota doctor              Check native OTA host integration
  run                     Install an artifact on an Android/iOS/HarmonyOS target
  logs                    Stream Android/iOS/HarmonyOS native logs
  build create            Create a local/cloud build job
  build list              List build jobs
  build status <id>       Show one build job
  build cancel <id>       Cancel a build job
  build retry <id>        Retry a failed build job
  build all               Build Android, iOS, HarmonyOS, Web and Desktop
  submit                  Submit the latest successful build
  update                  Upload and publish a signed OTA update
  update rollback         Roll back an OTA channel to a previous release
  rollback                Alias for update rollback
  self-host init          Generate local self-host credentials
  storage configure       Configure Cloudflare R2 and encrypted R2 credentials
  android host init       Create a minimal official Lynx Android host
  ios host init           Create a minimal official Lynx iOS/Xcode host
  android configure       Configure or generate encrypted Android signing credentials
  store configure         Configure Google Play or App Store Connect submission

Build options:
  --platform <p>          Target android, ios, harmony, web, desktop or all (default: android)
  --profile <name>        Build profile (default: production; simulator uses simulator)
  --no-wait               Queue the build without executing it locally
  --no-upload              Keep the artifact local and skip R2 (CI verification)
  --simulator             Build and install an iOS Simulator .app locally
  --device <id>           Select the iOS Simulator device for a simulator build
  --autostart              Open and launch the iOS Simulator app after install
  --no-autostart           Install the Simulator app without launching it
  --allow-unsigned         Allow an unsigned Desktop artifact only with --no-upload (local tests)
  --local                 Use the contract-only build path for tests

Submit options:
  --platform <p>          Target android or ios (default: android)
  --latest                Submit the latest successful build
  --local                 Use the mock submission provider for tests

Update options:
  --platform <p>          Target android or ios (default: android)
  --bundle <path[,path]>  Lynx bundle/assets (default: discover dist/*.lynx.bundle)
  --message <text>        Release message
  --local                 Create a local contract-only update for tests
  --policy-approval-id    Required for an iOS OTA release

Rollback options:
  --platform <p>          Target android or ios (default: android)
  --release-id <id>       Previously published compatible release
  --reason <text>         Required audit reason for the rollback
  --local                 Roll back local contract state for tests

Device and diagnostics options:
  doctor --platform <p>   Check the local toolchain (default: android)
  doctor --fix            Install missing Android SDK packages after confirmation
  autolink check --platform <p>
                          Check native-library wiring (default: android)
  ota doctor --platform <p>
                          Check OTA host integration (default: android)
  run --artifact <path>   Install a specific APK, IPA, app or signed HAP
  run --device <id>       Select an Android, iOS or HarmonyOS device
  run --simulator         Install an iOS .app with simctl
  run --launch             Launch the installed iOS Simulator app after install
  logs --device <id>      Select the device or simulator for native logs

Global options:
  --json                  Emit one stable JSON result/error object
  --quiet                 Print only the final machine-relevant result
  --verbose               Include extra operational context
  --no-color              Disable ANSI colors
  --non-interactive       Never prompt; fail on missing inputs
  --banner                Show the Braille LynxShip logo in a TTY
  --project-dir <path>    Use a LynxShip project from any working directory
  --project-id <id>       Project ID used by init
  --application-id <id>   Android package/application ID for host init
  --bundle-identifier <id> iOS bundle identifier for host init
  --icon <path>            1024x1024 PNG app icon for iOS host init
  --library-dir <path>    Native library directory for autolink codegen
  --simulator             Build/install an iOS .app or install one with simctl
  --help                  Show this complete command reference

Miso compiler profiles:
  ghcjs (default)        Use the official Miso GHC/Nix workflow
  microhs                 Use a pinned MicroHs binary and a real adapter command

MicroHs is opt-in. Configure build.<profile>.miso.microhs with either a
binary path or a pinned manifest, plus an adapter command that writes the
configured main.lynx.bundle. It is not a drop-in GHCJS replacement.

Node support: Node 22/24 LTS or Node 26 Current. Use Node 24 LTS for production.`;
}
