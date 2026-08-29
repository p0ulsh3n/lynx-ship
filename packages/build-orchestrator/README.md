# @lynxship/build-orchestrator

Build-domain primitives shared by the LynxShip control plane: validated build
creation, state transitions, retry/cancel rules, idempotency and deterministic
runtime/source inputs.

The package contains no process, filesystem, cloud or native-platform side
effects. Use a provider package to execute a build and persist the resulting
job through the API or a repository adapter.

A `BuildService` without an injected executor rejects execution. Use
`LocalBuildExecutor` explicitly only for local demos and contract tests; it
does not produce a real platform artifact.

## Usage and boundaries

Create jobs through `BuildService`, validate transitions before changing state,
and persist the resulting DTO through an injected repository. Idempotency keys
are scoped to the project and should be retained by the control plane for CI
retries. The package does not contain credentials, signing keys, shell
execution, or a hosted worker fleet.
