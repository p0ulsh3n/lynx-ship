# @lynxship/db

Server-side state repositories for LynxShip. `JsonRepository` provides atomic
local persistence for development and self-hosting; `PostgresStateRepository`
provides a PostgreSQL-backed state record with initialization, probing and
graceful shutdown.

PostgreSQL is never required in a mobile or Lynx bundle. Configure connection
URLs and credentials only in the control-plane environment, preferably through
a secret manager.

## Usage

Use `JsonRepository` for a local development or single-process self-hosted
control plane and `PostgresStateRepository` for a server deployment. Call
`initialize()` before using PostgreSQL, `probe()` for readiness checks, and
`close()` during graceful shutdown. Backups are integrity-checked with the
shared SHA-256 helper before restoration.

`JsonRepository.update()` serializes read-modify-write operations within its
repository instance and uses unique temporary files for atomic replacement.
The JSON driver remains a single-process development/self-hosting driver; use
PostgreSQL when multiple API processes must coordinate state.

These repositories store control-plane state; they are not a mobile database,
an end-user sync service, or a substitute for application-owned persistence.
