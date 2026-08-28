# Package catalog

This catalog is the boundary map for the pnpm workspace. A package marked
**public** may be published when its version and release checks are ready. A
package marked **private** is an internal service, worker or development
fixture and must not be published as an end-user SDK.

## Public packages

| Package                        | Role                                                                                                                  | API documentation                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@lynxship/cli`                | Terminal workflows for doctor, development, real native builds, artifacts, OTA and store submission.                  | [`packages/cli/README.md`](../packages/cli/README.md)                     |
| `create-lynxship-app`          | Safe project generator delegating framework scaffolding to official templates.                                        | [`packages/create-app/README.md`](../packages/create-app/README.md)       |
| `@lynxship/plugin-api`         | Versioned project-plugin contracts and permission boundaries.                                                         | [`packages/plugin-api/README.md`](../packages/plugin-api/README.md)       |
| `@lynxship/expo`               | Expo config plugin and native module that embeds LynxView and synchronizes signed Lynx bundles/assets.                | [`packages/expo/README.md`](../packages/expo/README.md)                   |
| `@lynxship/lynx-realtime`      | Secure bounded WebSocket client, presence, typing/recording activity, receipts and headless/in-app banner primitives. | [`packages/realtime/README.md`](../packages/realtime/README.md)           |
| `@lynxship/notifications`      | Client registration plus optional Node server adapters for FCM, APNs and Huawei Push Kit.                             | [`packages/notifications/README.md`](../packages/notifications/README.md) |
| `@lynxship/microhs`            | Verified MicroHs acquisition and adapter contract for experimental Miso workflows.                                    | [`packages/microhs/README.md`](../packages/microhs/README.md)             |
| `@lynxship/sdk-android`        | Native Android OTA client for a Lynx host.                                                                            | [`packages/sdk-android/README.md`](../packages/sdk-android/README.md)     |
| `@lynxship/sdk-ios`            | Native iOS OTA client for a Lynx host.                                                                                | [`packages/sdk-ios/README.md`](../packages/sdk-ios/README.md)             |
| `@lynxship/contracts`          | Shared identifiers, DTOs, hashes and validation helpers.                                                              | Source-level contract; used by the CLI and services.                      |
| `@lynxship/build-orchestrator` | Build state transitions and reproducibility primitives.                                                               | Source-level contract; not a hosted build service.                        |
| `@lynxship/db`                 | JSON and PostgreSQL state repositories for the control plane.                                                         | Source-level contract; PostgreSQL is server-side only.                    |
| `@lynxship/signing`            | Signing and verification primitives for OTA manifests.                                                                | Source-level contract; provider credentials remain external.              |
| `@lynxship/submit`             | Google Play and App Store Connect submission contracts.                                                               | Source-level contract; live submission needs developer credentials.       |

## Private packages

| Package                     | Role                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `@lynxship/api`             | Fastify control-plane API.                                                           |
| `@lynxship/auth`            | Internal tenant, token and authorization services.                                   |
| `@lynxship/build-providers` | Internal provider adapters for local/self-hosted builds.                             |
| `@lynxship/dashboard`       | Internal React/Vite operations dashboard.                                            |
| `@lynxship/queue`           | Internal memory/Redis queue adapters.                                                |
| `@lynxship/storage`         | Internal filesystem/R2 artifact adapters.                                            |
| `@lynxship/worker-agent`    | Internal worker registration, leases and execution protocol.                         |
| `@lynxship/worker-android`  | Android worker placeholder; isolated production fleet is not shipped by this repo.   |
| `@lynxship/worker-ios`      | macOS/iOS worker placeholder; isolated production fleet is not shipped by this repo. |

## Examples and validation

The `examples/` directory contains small fixtures, not a hosted service or a
promise that every framework is production-ready. The ReactLynx/Tailwind demo
validates bundle styling/assets and interactions; the Expo fixture validates
native embedding; the Octane and Miso fixtures preserve their experimental
upstream boundaries.

The root `test/` directory contains deterministic unit, contract and fixture
tests. Native device, store, Apple signing, cloud-worker isolation and live
provider tests remain external acceptance gates and are recorded in
[`status.md`](status.md) and [`acceptance-matrix.md`](acceptance-matrix.md).
