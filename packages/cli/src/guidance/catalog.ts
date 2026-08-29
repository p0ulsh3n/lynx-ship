import type { CliGuidance } from "./types.js";

export const guidance: Record<string, CliGuidance> = {
  CLI_PROJECT_REQUIRED: {
    commands: ["lynxship init", "lynxship doctor"],
    note: "Run them from the project directory or add --project-dir <path>.",
  },
  CLI_PROJECT_ID_REQUIRED: {
    commands: ["lynxship init", "lynxship doctor"],
  },
  CLI_R2_REQUIRED: {
    commands: ["lynxship storage configure", "lynxship doctor"],
  },
  CLI_R2_ACCOUNT_ID: {
    commands: ["lynxship storage configure"],
    note: "Use the 32-character Cloudflare account ID.",
  },
  CLI_R2_BUCKET: {
    commands: ["lynxship storage configure"],
    note: "Use a lowercase R2 bucket name with no spaces or underscores.",
  },
  CLI_R2_ENDPOINT: {
    commands: ["lynxship storage configure"],
    note: "Use the HTTPS S3 endpoint for the same Cloudflare account.",
  },
  CLI_R2_EXPIRY: {
    commands: ["lynxship storage configure"],
    note: "Choose a download lifetime between 1 second and 7 days.",
  },
  CLI_R2_CREDENTIALS: {
    commands: ["lynxship storage configure", "lynxship doctor"],
  },
  BUILD_SIGNING_REQUIRED: {
    commands: [
      "lynxship android configure",
      "lynxship doctor --platform android",
    ],
    note: "An existing .jks/.keystore is supported; production builds need a real release key.",
  },
  LYNXSHIP_KEYSTORE_PATH: {
    commands: ["lynxship android configure"],
  },
  LYNXSHIP_KEY_ALIAS: {
    commands: ["lynxship android configure"],
  },
  LYNXSHIP_KEYSTORE_PASSWORD: {
    commands: ["lynxship android configure"],
  },
  LYNXSHIP_KEY_PASSWORD: {
    commands: ["lynxship android configure"],
  },
  ANDROID_HOST_REQUIRED: {
    commands: [
      "lynxship dev",
      "lynxship android host init --application-id com.example.myapp",
      "lynxship build --platform android --application-id com.example.myapp --profile production",
      "lynxship doctor --platform android",
    ],
    note: "Interactive build creates a missing android/ host after asking for the application ID. CI must pass --application-id. Existing android/ directories are never overwritten.",
  },
  ANDROID_HOST_EXISTS: {
    commands: ["lynxship doctor --platform android"],
    note: "Review the existing android/ host instead of overwriting it.",
  },
  ANDROID_APPLICATION_ID_INVALID: {
    commands: ["lynxship android host init --application-id com.example.myapp"],
    note: "Use a reverse-domain Android application ID, for example com.company.app.",
  },
  ANDROID_PLATFORM_UNSUPPORTED: {
    commands: ["lynxship doctor --platform android"],
    note: "Android builds run on Windows, macOS or Linux. Use macOS for iOS builds.",
  },
  BUILD_ALL_MACOS_REQUIRED: {
    commands: [
      "lynxship build --platform android --profile production",
      "lynxship build --platform all --profile production --no-upload",
    ],
    note: "Run the all-platform command on a macOS machine or macOS CI worker; the second command is for CI verification.",
  },
  ANDROID_APKSIGNER_REQUIRED: {
    commands: [
      "lynxship doctor --platform android",
      'sdkmanager "build-tools;latest"',
    ],
    note: "Ensure Android SDK Build Tools are installed and available through ANDROID_HOME or ANDROID_SDK_ROOT.",
  },
  ANDROID_JARSIGNER_REQUIRED: {
    commands: ["lynxship doctor --platform android", "java -version"],
    note: "Install JDK 17 or newer and make sure jarsigner is on PATH.",
  },
  ANDROID_ADB_REQUIRED: {
    commands: ["lynxship doctor --platform android", "adb devices"],
    note: "Install Android SDK Platform-Tools and connect or start a device.",
  },
  ANDROID_TOOLCHAIN_REQUIRED: {
    commands: [
      "lynxship doctor --platform android",
      "lynxship doctor --platform android --fix",
      "lynxship build --platform android --profile production",
    ],
    note: "The doctor detects the project AGP/Gradle contract and the required JDK, Android SDK packages and Build Tools. --fix installs only missing SDK packages after confirmation.",
  },
  WEB_CONFIGURATION_REQUIRED: {
    commands: [
      "lynxship doctor --platform web",
      "lynxship build --platform web --profile production",
    ],
    note: "Configure environments.web in lynx.config.* or provide the project's build:web script.",
  },
  BUILD_MISO_NIX_REQUIRED: {
    commands: [
      "lynxship doctor --platform android",
      "nix --version",
      "lynxship build --platform android --profile production",
    ],
    note: "Install Nix and use the project's flake to build the Miso Lynx bundle.",
  },
  BUILD_MISO_ATTRIBUTE_REQUIRED: {
    commands: [
      "lynxship init",
      "lynxship build --platform android --profile production",
    ],
    note: "Expose a default/mkLynxBundle output or set build.production.miso.attribute to the Nix flake output that creates main.lynx.bundle.",
  },
  BUILD_MISO_BUNDLE_MISSING: {
    commands: [
      "nix build",
      "lynxship build --platform android --profile production",
    ],
    note: "Check build.production.miso.artifact and the output produced by the Miso flake.",
  },
  BUILD_MISO_MICROHS_ADAPTER_REQUIRED: {
    commands: [
      "lynxship doctor --platform android",
      "lynxship inspect",
      "lynxship build --platform android --profile production",
    ],
    note: "MicroHs is opt-in and is not a drop-in GHCJS replacement. Configure build.<profile>.miso.microhs with a pinned binary or manifest and a real adapter command, or set build.<profile>.miso.compiler to ghcjs.",
  },
  BUILD_MISO_MICROHS_ADAPTER_FAILED: {
    commands: [
      "lynxship doctor --platform android --profile production",
      "lynxship inspect",
      "lynxship build --platform android --profile production",
    ],
    note: "The real adapter or MicroHs compiler rejected the Miso source or failed to write the Lynx bundle. This does not prove Miso/MicroHs compatibility; use the official GHC/Nix workflow until the adapter supports the project's language extensions, packages, FFI and bundle output.",
  },
  BUILD_MISO_ARTIFACT_OUTSIDE_PROJECT: {
    commands: ["lynxship inspect", "lynxship doctor --platform android"],
    note: "Set build.<profile>.miso.artifact to a file inside the project, such as result/main.lynx.bundle.",
  },
  BUILD_MISO_BUNDLE_INVALID: {
    commands: [
      "lynxship inspect",
      "lynxship build --platform android --profile production",
    ],
    note: "The configured Miso artifact must be a non-empty file produced by the adapter.",
  },
  MICROHS_MANIFEST_REQUIRED: {
    commands: [
      "lynxship doctor --platform android",
      "lynxship inspect",
      "lynxship build --platform android --profile production",
    ],
    note: "Provide build.<profile>.miso.microhs.binary for an existing verified mhs binary, or provide a pinned manifest/manifestUrl. LynxShip never downloads an unpinned compiler.",
  },
  MICROHS_HOST_UNSUPPORTED: {
    commands: ["lynxship doctor --platform android", "lynxship inspect"],
    note: "Use a verified MicroHs host binary for darwin-arm64, darwin-x64, linux-arm64, linux-x64 or win32-x64, or select the official ghcjs workflow.",
  },
  MICROHS_ARTIFACT_UNAVAILABLE: {
    commands: ["lynxship doctor --platform android", "lynxship inspect"],
    note: "Publish or select a manifest artifact for the current host architecture. The compiler host architecture is independent from the Android/iOS packaging target.",
  },
  MICROHS_BINARY_MISSING: {
    commands: ["lynxship doctor --platform android", "lynxship inspect"],
    note: "The configured MicroHs binary does not exist. Fix build.<profile>.miso.microhs.binary or use a pinned manifest.",
  },
  MICROHS_VERSION_MISMATCH: {
    commands: ["lynxship inspect", "lynxship doctor --platform android"],
    note: "The requested MicroHs version does not match the pinned manifest. Keep compiler and adapter versions aligned.",
  },
  MICROHS_MANIFEST_INVALID: {
    commands: ["lynxship inspect", "lynxship doctor --platform android"],
    note: "The MicroHs manifest is invalid. It must declare schemaVersion 1, a source commit and SHA-256-pinned artifacts.",
  },
  MICROHS_MANIFEST_READ_FAILED: {
    commands: ["lynxship inspect", "lynxship doctor --platform android"],
    note: "Check the configured local MicroHs manifest path and permissions.",
  },
  MICROHS_MANIFEST_FETCH_FAILED: {
    commands: ["lynxship inspect", "lynxship doctor --platform android"],
    note: "Check the pinned MicroHs manifest URL and network access. LynxShip does not silently fall back to an unverified download.",
  },
  MICROHS_HASH_MISMATCH: {
    commands: ["lynxship inspect", "lynxship doctor --platform android"],
    note: "The downloaded compiler did not match its pinned SHA-256. Do not reuse the cache; verify the release manifest and artifact source.",
  },
  MICROHS_SIGNATURE_INVALID: {
    commands: ["lynxship inspect", "lynxship doctor --platform android"],
    note: "The MicroHs artifact signature did not verify. Check the pinned release public key and manifest; the binary was rejected.",
  },
  MICROHS_SIGNATURE_KEY_REQUIRED: {
    commands: ["lynxship inspect", "lynxship doctor --platform android"],
    note: "The manifest declares a signed MicroHs artifact. Configure the pinned public key before using it.",
  },
  WEB_BUNDLE_MISSING: {
    commands: [
      "lynxship doctor --platform web",
      "lynxship build --platform web --profile production",
    ],
    note: "The official Web output is dist/*.web.bundle; check the Rspeedy Web environment and artifact path.",
  },
  HARMONY_HOST_REQUIRED: {
    commands: [
      "lynxship doctor --platform harmony",
      "lynxship build --platform harmony --profile production",
    ],
    note: "Use the official Lynx Harmony host; LynxShip does not invent a fake HAP host.",
  },
  HARMONY_TOOLCHAIN_REQUIRED: {
    commands: [
      "lynxship doctor --platform harmony",
      "lynxship build --platform harmony --profile production",
    ],
    note: "Install the DevEco/OpenHarmony SDK, expose ohpm and use the host's pinned hvigorw wrapper.",
  },
  HARMONY_SIGN_TOOL_REQUIRED: {
    commands: [
      "lynxship doctor --platform harmony",
      "lynxship build --platform harmony --profile production",
    ],
    note: "Set LYNXSHIP_HAP_SIGN_TOOL to the official hap-sign-tool.jar or configure build.<profile>.harmony.signTool.",
  },
  HARMONY_HDC_REQUIRED: {
    commands: [
      "lynxship doctor --platform harmony",
      "lynxship run --platform harmony --device <device-id>",
      "lynxship logs --platform harmony --device <device-id>",
    ],
    note: "Install the OpenHarmony SDK platform tools and make hdc available on PATH.",
  },
  DESKTOP_HOST_REQUIRED: {
    commands: [
      "lynxship doctor --platform desktop",
      "lynxship build --platform desktop --profile production",
    ],
    note: "Use the official Lynxtron host and its electron-builder configuration or pack script.",
  },
  DESKTOP_ARTIFACT_MISSING: {
    commands: [
      "lynxship doctor --platform desktop",
      "lynxship build --platform desktop --profile production",
    ],
    note: "Configure the Lynxtron pack script and set build.<profile>.desktop.artifact when output is not unique.",
  },
  DESKTOP_SIGNING_REQUIRED: {
    commands: [
      "lynxship doctor --platform desktop",
      "lynxship build --platform desktop --profile production",
      "lynxship build --platform desktop --profile production --no-upload --allow-unsigned",
    ],
    note: "Production and uploaded Desktop artifacts must pass Windows Authenticode or Apple code-signature verification. Use --allow-unsigned only for local packaging tests together with --no-upload; it can never publish an unsigned artifact.",
  },
  TARGET_RUN_UNSUPPORTED: {
    commands: [
      "lynxship preview",
      "lynxship run --platform android --artifact <apk>",
      "lynxship run --platform harmony --artifact <hap>",
    ],
    note: "Web and desktop artifacts use their target runtime or operating-system installer; only device targets are installed by this command.",
  },
  TARGET_LOGS_UNSUPPORTED: {
    commands: [
      "lynxship dev",
      "lynxship logs --platform android",
      "lynxship logs --platform harmony",
    ],
    note: "Web and desktop logs come from their runtime tooling; LynxShip streams native device logs only.",
  },
  CLI_DOCTOR_FIX_PLATFORM: {
    commands: ["lynxship doctor --platform android --fix"],
    note: "The guided repair currently installs Android SDK packages only; JDK and Android Studio remain explicit developer installations.",
  },
  LYNX_BUNDLE_MISSING: {
    commands: ["lynxship dev", "lynxship build --platform android"],
    note: "Build the Lynx bundle with the project's configured package manager.",
  },
  IOS_HOST_REQUIRED: {
    commands: [
      "lynxship dev",
      "lynxship ios host init --bundle-identifier com.example.myapp",
      "lynxship build --platform ios --bundle-identifier com.example.myapp --profile production",
      "lynxship doctor --platform ios",
    ],
    note: "Interactive build creates a missing ios/ host after asking for the bundle identifier. CI must pass --bundle-identifier. Existing ios/ directories are never overwritten.",
  },
  IOS_HOST_EXISTS: {
    commands: ["lynxship doctor --platform ios"],
    note: "Review the existing ios/ host instead of overwriting it.",
  },
  IOS_BUNDLE_IDENTIFIER_INVALID: {
    commands: ["lynxship ios host init --bundle-identifier com.example.myapp"],
    note: "Use a reverse-domain bundle identifier, for example com.company.app.",
  },
  IOS_MACOS_REQUIRED: {
    commands: ["lynxship doctor --platform ios"],
    note: "Run real iOS commands on macOS. Windows and Linux cannot produce an IPA.",
  },
  IOS_XCODE_REQUIRED: {
    commands: ["xcode-select --install", "lynxship doctor --platform ios"],
    note: "Install Xcode from the Mac App Store and select its command-line tools.",
  },
  IOS_XCRUN_REQUIRED: {
    commands: ["xcode-select --install", "lynxship doctor --platform ios"],
  },
  IOS_TOOLCHAIN_REQUIRED: {
    commands: [
      "lynxship doctor --platform ios",
      "lynxship ios host init --bundle-identifier com.example.myapp",
      "lynxship build --platform ios --profile production",
    ],
    note: "The iOS doctor checks macOS, Xcode, xcrun, CocoaPods, Xcode settings, Apple signing identities, provisioning and export options without printing certificate contents.",
  },
  IOS_SIMULATOR_PLATFORM: {
    commands: [
      "lynxship doctor --platform ios --profile simulator",
      "lynxship build --platform ios --simulator --profile simulator --no-upload",
    ],
    note: "The iOS Simulator target is selected with --platform ios; Android, Web and Desktop targets cannot use this flag.",
  },
  IOS_SIMULATOR_RUNTIME_REQUIRED: {
    commands: [
      "xcode-select --install",
      "lynxship doctor --platform ios --profile simulator",
      "lynxship build --platform ios --simulator --profile simulator --no-upload",
    ],
    note: "Install an iOS Simulator runtime in Xcode > Settings > Components, then rerun the doctor.",
  },
  IOS_SIMULATOR_ARTIFACT_MISSING: {
    commands: [
      "lynxship doctor --platform ios --profile simulator",
      "lynxship build --platform ios --simulator --profile simulator --no-upload",
    ],
    note: "The simulator build must produce an .app under DerivedData before it can be installed.",
  },
  IOS_SIMULATOR_UPLOAD_BLOCKED: {
    commands: [
      "lynxship build --platform ios --simulator --profile simulator --no-upload",
      "lynxship build --platform ios --profile production",
    ],
    note: "Simulator .app artifacts stay local; use a signed production device build for R2 upload and distribution.",
  },
  IOS_COCOAPODS_REQUIRED: {
    commands: [
      "brew install cocoapods",
      "cd ios && pod install --repo-update",
      "lynxship doctor --platform ios --profile simulator",
      "lynxship build --platform ios --simulator --profile simulator --no-upload",
    ],
    note: "CocoaPods is required when the iOS host contains a Podfile. The first install refreshes the CocoaPods specs repository.",
  },
  IOS_PROJECT_REQUIRED: {
    commands: [
      "lynxship ios host init --bundle-identifier com.example.myapp",
      "lynxship doctor --platform ios",
    ],
  },
  IOS_SCHEME_REQUIRED: {
    commands: [
      "lynxship inspect",
      "lynxship doctor --platform ios --profile simulator",
      "lynxship doctor --platform ios --profile production",
    ],
    note: "Set build.<profile>.ios.scheme in lynxship.json.",
  },
  IOS_EXPORT_OPTIONS_REQUIRED: {
    commands: [
      "lynxship ios host init --bundle-identifier com.example.myapp",
      "lynxship doctor --platform ios",
      "lynxship build --platform ios --simulator --profile simulator --no-upload",
    ],
    note: "Set build.<profile>.ios.exportOptionsPlist for a device IPA; simulator .app builds do not require export options.",
  },
  IOS_DEVICE_REQUIRED: {
    commands: [
      "xcrun devicectl list devices",
      "lynxship run --platform ios --device <device-id>",
    ],
  },
  IOS_DEVICE_LOGS_UNSUPPORTED: {
    commands: [
      "xcrun simctl list devices",
      "lynxship logs --platform ios --device <simulator-id>",
    ],
  },
  DEVICE_ARTIFACT_REQUIRED: {
    commands: [
      "lynxship build --platform android --profile production",
      "lynxship run --platform android --artifact <path-to-apk>",
    ],
  },
  LYNX_CODEGEN_SCRIPT_REQUIRED: {
    commands: [
      "lynxship autolink check --platform android",
      "lynxship autolink codegen --library-dir <native-library>",
    ],
    note: "The native library must expose its official codegen script.",
  },
  LYNX_AUTOLINK_ANDROID_REQUIRED: {
    commands: [
      "lynxship autolink check --platform android",
      "lynxship autolink codegen --library-dir <native-library>",
    ],
  },
  LYNX_AUTOLINK_IOS_REQUIRED: {
    commands: [
      "lynxship autolink check --platform ios",
      "lynxship autolink codegen --library-dir <native-library>",
    ],
  },
  OTA_HOST_INTEGRATION_REQUIRED: {
    commands: [
      "lynxship ota doctor --platform android",
      "lynxship ota doctor --platform ios",
    ],
    note: "Integrate the LynxShip OTA client in the native host before publishing updates.",
  },
  OTA_NATIVE_CHANGE_REQUIRED: {
    commands: [
      "lynxship ota doctor --platform android",
      "lynxship build --platform android --profile production",
      "lynxship update --platform android --bundle dist/main.lynx.bundle",
    ],
    note: "Native changes require a new compatible binary before an OTA release.",
  },
  OTA_BUNDLE_REQUIRED: {
    commands: [
      "lynxship build --platform android --profile production",
      "lynxship update --platform android --bundle dist/main.lynx.bundle",
    ],
  },
  BUILD_REQUIRED: {
    commands: ["lynxship build --platform android --profile production"],
  },
  STORE_ARTIFACT_REQUIRED: {
    commands: [
      "lynxship build --platform android --profile production",
      "lynxship submit --platform android --latest",
    ],
  },
  STORE_SUBMISSION_REQUIRED: {
    commands: [
      "lynxship store configure --platform android",
      "lynxship submit --platform android --latest",
    ],
  },
  RELEASE_NOT_FOUND: {
    commands: [
      "lynxship update --platform android",
      "lynxship update rollback --help",
    ],
  },
  ROLLBACK_RELEASE_REQUIRED: {
    commands: [
      'lynxship update rollback --platform android --release-id <release-id> --reason "reason"',
    ],
  },
  ROLLBACK_REASON_REQUIRED: {
    commands: [
      'lynxship update rollback --platform android --release-id <release-id> --reason "reason"',
    ],
  },
  CLI_INTERACTIVE_REQUIRED: {
    commands: ["lynxship <command>"],
    note: "Run without --non-interactive, or provide the documented CI environment variables.",
  },
  PROFILE_NOT_FOUND: {
    commands: ["lynxship inspect", "lynxship build --profile production"],
    note: "Use a profile declared under build in lynxship.json.",
  },
  PLATFORM_INVALID: {
    commands: [
      "lynxship build --platform android",
      "lynxship build --platform ios",
      "lynxship build --platform all",
    ],
  },
  IOS_SIGNATURE_INVALID: {
    commands: [
      "lynxship doctor --platform ios",
      "lynxship build --platform ios --profile production",
    ],
    note: "Check the Apple certificate, provisioning profile, team and export options.",
  },
  CLI_DEVTOOL_COMMAND: {
    commands: [
      "lynxship devtool doctor --platform android",
      "lynxship trace doctor --platform android",
      "lynxship recorder doctor --platform android",
    ],
    note: "Lynx Trace and Recorder are operated from Lynx DevTool Desktop after the native -dev runtime is integrated.",
  },
};
