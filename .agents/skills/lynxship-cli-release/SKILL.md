---
name: lynxship-cli-release
description: Build, review, secure, test, and release LynxShip CLI workflows including R2 artifacts, Android/iOS/HarmonyOS signing, Web and Desktop packaging, OTA, store submission, CI, and npm publishing.
metadata:
  short-description: LynxShip CLI builds, security, OTA, stores, and CI
---

# LynxShip CLI release engineering

Use this skill for changes to `packages/cli`, build orchestration, artifact
storage, signing, OTA publishing/rollback, Google Play or App Store Connect
submission, GitHub Actions, package publishing, or release documentation.

## First read

Read [references/source-policy.md](references/source-policy.md) for the
current-information and primary-source rules. Then read the relevant section
of [references/cli-workflows.md](references/cli-workflows.md) and the security
requirements in [references/release-security.md](references/release-security.md).

## Core invariants

- The CLI may run from any working directory when `--project-dir` is supplied;
  otherwise it resolves the current project. Machine configuration belongs in
  the platform-appropriate global LynxShip directory, not in a contributor's
  user profile or a committed project secret.
- `lynxship.json` is project metadata and may be initialized automatically
  only after a real Lynx project is detected. It must contain a unique UUID v4
  project ID; never use a shared placeholder.
- A real build is a stateful pipeline: detect toolchain, run the project's
  pinned Rspeedy build, synchronize the bundle, run the native build, verify
  the signature, name the artifact with a UUID, and only then upload to R2.
  `--local` is a contract test path, not an APK/IPA generator.
- Never report an artifact as signed, uploaded, submitted, or OTA eligible
  until the corresponding local verification or provider response succeeded.
- Android is buildable on Windows, Linux, and macOS. iOS archive/export is
  macOS/Xcode-only; a Linux or Windows job must fail clearly and never create
  a fake IPA.
- HarmonyOS builds use the official Lynx Harmony host, DevEco/OpenHarmony
  toolchain and HAP verifier. Web builds use Rspeedy's Web environment. Desktop
  builds use Lynxtron/electron-builder. Missing official inputs must fail;
  never emit a placeholder HAP, Web bundle or installer.
- An OTA update can change compatible JavaScript/assets only. Native code,
  permissions, native dependencies, Autolink registries, or runtime inputs
  require a new binary. Rollback moves a release pointer and does not undo a
  native binary.
- Secret input must be hidden, stored by the OS credential backend or CI
  secret store, redacted from logs, scoped to its provider, and revocable.
  Never print a secret, signed URL query string, private key, keystore
  password, service-account JSON, or provisioning profile contents.

## Command routing

- `init`, `doctor`: project discovery, UUID configuration, toolchain and host
  diagnostics.
- `dev`, `preview`, `inspect`, `profile`: Rspeedy development and inspection;
  they do not imply a store-ready native build.
- `android host init`, `ios host init`: create a host only when its platform
  directory is absent; never overwrite an existing native application.
- `android configure`, `store configure`: collect hidden signing/submission
  credentials and save them through the secure store. Existing credentials
  from another framework must remain usable when their formats are supported.
- `build`, `submit`: build/sign/store and then submit only the latest verified
  artifact. Use `--no-upload` for CI verification without R2 credentials.
- `update`, `update rollback`, `rollback`: publish a signed compatible OTA or
  move the channel pointer back with an auditable reason.
- `storage configure`: validate Cloudflare R2 before accepting the provider;
  use presigned downloads with bounded lifetimes, never public buckets for
  private artifacts.
- `autolink check`, `autolink codegen`, `ota doctor`, `run`, `logs`: inspect
  native wiring, generate official module bindings, verify OTA hooks, install
  artifacts, and collect device logs.

## Required handoff evidence

Before calling a change complete, record:

1. the exact commands and platform used;
2. the source/version URLs checked;
3. the result of `pnpm check` and focused tests;
4. whether the result was a contract test, unsigned simulator build, signed
   local artifact, uploaded artifact, or store submission;
5. any external credential or macOS/Apple/Google dependency that was not
   available in the current environment.

Do not claim "production ready" from a mock provider, a local state machine,
an unsigned artifact, or a CI job that did not execute the platform's real
toolchain.

## References

- [CLI workflows and command contracts](references/cli-workflows.md)
- [R2, signing, credentials, OTA, stores, and threat boundaries](references/release-security.md)
- [Verification matrix and CI expectations](references/verification-matrix.md)
- [Current-source research and update procedure](references/source-policy.md)
