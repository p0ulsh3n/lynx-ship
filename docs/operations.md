# Operations runbook

## Health

`GET /health` is liveness. `GET /ready` reports whether the current state backend is available. Production deployments must include database, queue and object-store probes.

## Bad OTA release

Pause the release, inspect telemetry, select a known-good release from the channel history, then execute:

```bash
lynxship update rollback --platform android --release-id <release-id> --reason "Incident reference and remediation"
```

Use `--platform ios` for an iOS channel. Verify update checks on a canary
installation. Keep the signed release and audit record; rollback changes the
channel pointer and does not delete evidence or the R2 artifact. Native code
changes still require a new binary build and store submission.

## Queue outage

Stop new scheduling, preserve queued records, recover expired leases after the worker pool is healthy, and inspect dead-letter items before retrying. A retry must not duplicate an acknowledged artifact or submission.

## Secret incident

Revoke the credential, rotate the dependent secret, inspect audit/delivery logs, and rebuild affected artifacts. Never print the old value in a ticket or diagnostic output.

The local JSON state is for development. The production Docker overlay uses PostgreSQL for control-plane state, Redis with append-only persistence for queued build IDs, and Cloudflare R2 for signed artifacts. Configure R2 through `lynxship storage configure`; the CLI verifies the bucket, uploads artifacts directly, and emits time-limited download URLs. Render `compose.production.yaml` with `.env.production`, verify `/ready` before accepting traffic, then exercise a create/restart/read smoke test after every image or schema change. A production operator must still document database/object-store backup, restore, encryption-key recovery, TLS termination, token rotation and upgrade/rollback procedures before declaring the deployment Stable.

The production credential vault also requires `LYNXSHIP_CREDENTIAL_MASTER_KEY`
outside the repository. It encrypts provider secrets with AES-256-GCM and
persists only ciphertext in the control-plane state. Losing this key makes the
encrypted records unrecoverable, so it must be backed up through the same
protected secret-management process as the database backup.

API tokens are persisted in the durable control-plane state and may be created
or revoked through `/v1/tokens`. The token value is returned only by the create
response; subsequent list responses contain metadata without the secret. Use
organization- and project-scoped tokens for automation, reserve the
environment bootstrap token for initial administration, and rotate it after
creating scoped tokens.
