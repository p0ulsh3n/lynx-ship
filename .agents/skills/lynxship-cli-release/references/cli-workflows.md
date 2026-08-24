# LynxShip CLI workflow contracts

## Project and machine scope

```text
working directory + --project-dir
        ↓
project discovery
        ↓
lynxship.json (UUID v4 project metadata)
        ↓
global machine credentials/configuration
        ↓
platform build or diagnostics
```

`--project-dir` is optional inside the project and required when invoking the
CLI from elsewhere. Project metadata belongs in the project; credentials
belong in the OS credential store or CI secret manager. Do not commit R2 keys,
keystores, `.p12`, `.p8`, service-account JSON, provisioning profiles or
passwords.

## Development commands

- `init`: create or link `lynxship.json` and a UUID v4 project ID.
- `doctor`: report actionable toolchain, host, credentials, lockfile,
  Autolink and OTA readiness. A warning is not a failed check; a missing
  required host must fail the real build.
- `dev`: run the project's local Rspeedy dev server and expose its QR/HMR
  workflow. It does not need an Android/iOS host.
- `preview`: serve production bundle output after a real bundle build.
- `inspect`: inspect Rspeedy/Rspack configuration; do not treat inspection as
  a build.
- `profile`: enable build profiling and report the output location.

## Native host and build commands

- `android host init --application-id <id>` and
  `ios host init --bundle-identifier <id>` create only missing minimal hosts.
- `android configure` accepts an existing keystore or generates only the
  explicitly requested development key. Existing signing identities must be
  supported without replacement.
- `build --platform android|ios --profile <name>` runs the real pipeline:
  bundle, sync, native build, signature verification, UUID artifact name and
  optional R2 upload.
- `build --no-upload` is a useful CI verification mode but is not an upload
  test. `build --local` is a contract-state test and must never be reported as
  a native artifact.
- `run` and `logs` require the target platform tools (`adb` or macOS
  `xcrun`/`simctl`) and report the target identifier used.

## Submission and OTA

- `store configure --platform android|ios` stores provider credentials hidden
  and scoped; it does not prove store access until a provider request succeeds.
- `submit --latest` may submit only the latest successful, verified artifact.
- `update --bundle ...` publishes only a signed bundle/assets set that is
  compatible with a successful binary runtime fingerprint.
- `update rollback --release-id ... --reason ...` and `rollback` move a
  channel pointer with an audit reason. They do not alter native code.
- `ota doctor` checks native download, verification, activation and fallback
  hooks before an OTA release.

## Failure semantics

Every external command must preserve its exit code, capture a redacted event,
and leave the build state failed when it fails. A successful Gradle/Xcode task
does not imply a successful upload. A successful upload does not imply a
successful store submission. Keep each boundary observable in logs and JSON.
