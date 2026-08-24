# LynxShip platform map

Use the existing package boundary before creating a new package or shared
utility. The names below describe the current repository; verify the source
before assuming a capability is complete.

| Area                | Location                                                       | Responsibility and invariant                                                                                                                    |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts           | `packages/contracts`                                           | Typed IDs, build states, roles, artifacts, releases, OTA manifests, canonical JSON and hashes. Changes are compatibility-sensitive.             |
| Auth and tenants    | `packages/auth`, API services                                  | Tokens, revocation, roles, scopes, organization/project ownership. Enforce on the server.                                                       |
| API                 | `packages/api`                                                 | Fastify routes, runtime backend selection, health/readiness, rate limits, audit, telemetry, webhooks and resource lifecycle.                    |
| Database            | `packages/db`                                                  | Repository interfaces, JSON test adapter, PostgreSQL adapter, backups and migrations. Preserve equivalent semantics.                            |
| Queue               | `packages/queue`                                               | In-memory and Redis leases, retries, heartbeats, dead letters and recovery.                                                                     |
| Storage             | `packages/storage`                                             | Local/test object storage and R2/S3 object storage, hashes, immutable artifacts and presigned access.                                           |
| Build orchestration | `packages/build-orchestrator`, `packages/build-providers`      | State machine, cache/source manifest, runtime fingerprint and provider capability selection.                                                    |
| Signing and OTA     | `packages/signing`, `packages/sdk-android`, `packages/sdk-ios` | Ed25519 manifests, key rotation/revocation, staged activation, fallback and native-change policy.                                               |
| Store submission    | `packages/submit`                                              | Google Play and App Store Connect providers plus local mocks. Provider responses are evidence, not assumptions.                                 |
| Workers             | `packages/worker-agent`                                        | Worker registration, heartbeat, draining and revocation. `worker-android` and `worker-ios` remain planned until real executors are implemented. |
| Dashboard           | `packages/dashboard`                                           | React/Vite UI, TanStack Router/Query, Tailwind and shadcn-style UI. Browser code never owns secrets.                                            |
| CLI                 | `packages/cli`                                                 | User-facing orchestration. Use `lynxship-cli-release` for CLI-specific changes.                                                                 |

Cross-package changes should start at `packages/contracts` and finish with
focused API, persistence, queue, storage, signing and dashboard tests as
applicable. Avoid importing an implementation package into contracts.
