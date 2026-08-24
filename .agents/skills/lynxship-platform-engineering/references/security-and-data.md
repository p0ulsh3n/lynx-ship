# Security and data rules

## Trust boundaries

Treat the CLI, dashboard, worker, API, database, queue, object storage and
external store providers as separate trust boundaries. The browser and CLI
are untrusted callers. A project ID supplied by a caller is not proof of
ownership; resolve it through the authenticated tenant directory.

## Secrets

- Keep R2 keys, store credentials, signing keys and tokens in the machine
  vault or CI secret manager, never in `lynxship.json`, source, fixtures or
  logs.
- Redact authorization headers, service-account JSON, private key material,
  passwords, tokens and presigned URLs in errors and telemetry.
- Use least-privilege, revocable credentials and short lifetimes. Rotate on
  suspected exposure and record the incident without copying the secret into
  an issue or audit event.

## Identity, authorization and tenancy

Every mutating resource operation must check authentication, role scope,
organization membership and project ownership. Keep public health checks
minimal. Add tests for cross-tenant reads, updates, downloads, queue claims,
webhooks and submission operations.

## Integrity

Use canonical JSON before signing or hashing. Keep artifact bytes immutable,
verify SHA-256 and size, and bind OTA manifests to the runtime fingerprint,
channel, release policy and immutable object URL. Ed25519 verification and key
rotation/revocation must fail closed.

## Data lifecycle

Migrations are ordered and idempotent. Backups are encrypted, access-limited,
and verified by restore or integrity checks. Queue jobs are idempotent and
recoverable after a crashed worker. Expired presigned URLs and temporary
records should be pruned without deleting immutable release history.

## Webhooks and external providers

Verify signatures against the exact raw body, reject stale or replayed events,
and make handlers idempotent. Store provider IDs and status transitions, not
unbounded raw payloads. Tests using local provider mocks must be labeled as
contract tests and must not be reported as a successful store submission.
