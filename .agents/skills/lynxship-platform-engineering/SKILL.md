---
name: lynxship-platform-engineering
description: Design, review, test, and operate LynxShip's API, contracts, persistence, queues, storage, workers, dashboard, telemetry, and multi-tenant control plane using current primary documentation.
metadata:
  short-description: LynxShip control plane, data, workers, dashboard, and security
---

# LynxShip platform engineering

Use this skill for changes outside the LynxJS/native-host and CLI-specific
workflows: API routes, contracts, authentication, tenants, database adapters,
durable queues, R2 storage, workers, OTA service boundaries, dashboard API
clients, telemetry, webhooks, migrations, and platform security.

## First read

Read [references/source-policy.md](references/source-policy.md) before changing
an integration. Then read the relevant map and security guidance:

- [architecture-map.md](references/architecture-map.md) for package ownership;
- [security-and-data.md](references/security-and-data.md) for trust boundaries;
- [verification.md](references/verification.md) for evidence and required checks.

## Source and change discipline

- Use primary, current documentation and the repository's locked dependency
  versions. Record the URL, version or commit, and date when an external API
  decision matters.
- Never assume a future provider or framework version is compatible. Inspect
  its current migration guide and changelog, update the lockfile deliberately,
  then run the complete verification path.
- Treat contracts as the boundary between API, CLI, workers, dashboard and
  persistence. Change types and validation first, then adapters and callers.
- Preserve backward compatibility for persisted records and API responses.
  Add migrations and compatibility readers before changing writers.
- Keep modules small and boring. Prefer explicit adapters and typed functions
  over reflection, hidden global state, or a new abstraction with one caller.

## Core invariants

- Every organization, project, build, artifact, release, credential, worker,
  device, and webhook operation is tenant and project scoped where applicable.
  Authorization is enforced server-side; the dashboard or CLI is not a trust
  boundary.
- Public health endpoints remain public only when the route contract says so.
  Mutating and sensitive routes require a valid token, role scope, project
  ownership check, rate limit, and audit record where required.
- Production persistence is PostgreSQL, durable queue state is Redis, and
  artifact bytes are Cloudflare R2. JSON, memory, and local filesystem
  adapters are for tests or explicitly local development. Do not silently
  substitute them in a production profile.
- Artifacts are immutable and addressed by content hash and UUID identity.
  Presigned URLs are short-lived and scoped. Never log credentials, private
  keys, tokens, full presigned URLs, or raw service-account contents.
- Queue jobs are idempotent. Leases have heartbeats, expiry recovery, retry
  limits, dead-letter behavior, draining, and worker revocation. A worker must
  not continue claiming work after it is revoked or draining.
- OTA manifests bind the runtime fingerprint, immutable bundle URLs, hashes,
  signatures, channel and compatibility policy. Native changes require a new
  binary; do not bypass this with a flag or an unverified manifest.
- Webhook signatures are verified against the exact request body with replay
  protection. Audit records and security-relevant events are append-only.

## Implementation workflow

1. Identify the package boundary and read its current tests before editing.
2. Write or update the contract and validation rule.
3. Implement the smallest adapter or route change, keeping JSON/local adapters
   useful for deterministic tests.
4. Add tenant, authorization, idempotency, error, migration and redaction
   tests for the changed behavior.
5. Run focused tests, then `pnpm check` and `pnpm verify`.
6. Inspect the final diff, generated files, package exports and lockfile. Do
   not report production readiness when a provider, worker or platform is
   still marked planned.

## Area-specific rules

### API and auth

Validate input at the route boundary, return stable error contracts, enforce
scopes in the service layer, and keep authorization independent from route
ordering. Rate limits and retry hints must be bounded and observable without
leaking secrets.

### Database and migrations

Use the repository interfaces so JSON and PostgreSQL implementations preserve
the same semantics. Migrations must be ordered, contiguous, idempotent, and
safe to apply once. Backups must be integrity-checked before being called
recoverable. Never make a destructive schema change without a compatibility
reader and a documented rollback plan.

### Queue and workers

Model state transitions explicitly. A completed job must not be completed
twice; a lease timeout must be recoverable; retries must be bounded; and
dead-letter records must retain enough redacted context to diagnose the cause.
`worker-android` and `worker-ios` are not production-complete just because the
shared worker registry exists; preserve their documented planned status until
real executors and platform tests land.

### Storage and artifacts

Use the storage adapter, not direct filesystem writes, for control-plane
artifacts. R2 S3 credentials are least-privilege and machine/CI secrets stay
outside project files. Verify size and SHA-256 after upload/download. Keep
download URLs expiring and never put secret configuration in a URL.

### Dashboard

Treat the API contract as authoritative. Keep TanStack Router route data and
TanStack Query cache keys aligned with project and tenant scope. Handle loading,
empty, unauthorized, conflict and retry states explicitly. Do not put a secret
or a signing operation in browser code.

### Operations and observability

Health and readiness mean different things. Readiness must reflect required
durable backends, while health should remain useful during dependency failure.
Use structured, redacted events with correlation IDs. Metrics and telemetry
must not become an alternate credential or personal-data store.

## Required output

When a change is complete, report which contract changed, which adapters and
platforms were exercised, which tests passed, and which capability remains
planned or requires a real external account. A green unit test is not proof
of a live PostgreSQL, Redis, R2, store, or worker deployment.
