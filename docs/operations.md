# Operations runbook

## Health

`GET /health` is liveness. `GET /ready` reports whether the current state backend is available. Production deployments must include database, queue and object-store probes.

## Bad OTA release

Pause the release, inspect telemetry, select a known-good release from the channel history, execute an explicit rollback, then verify update checks on a canary installation. Keep the signed release and audit record; do not delete evidence during incident response.

## Queue outage

Stop new scheduling, preserve queued records, recover expired leases after the worker pool is healthy, and inspect dead-letter items before retrying. A retry must not duplicate an acknowledged artifact or submission.

## Secret incident

Revoke the credential, rotate the dependent secret, inspect audit/delivery logs, and rebuild affected artifacts. Never print the old value in a ticket or diagnostic output.

The local JSON state is for development. The Docker profile uses PostgreSQL for control-plane state, Redis with append-only persistence for queued build IDs, and Cloudflare R2 for signed artifacts. Configure R2 through `lynxship storage configure`; the CLI verifies the bucket, uploads artifacts directly, and emits time-limited download URLs. Verify `/ready` before accepting traffic, then exercise a create/restart/read smoke test after every image or schema change. A production operator must still document database/object-store backup, restore, encryption-key recovery and upgrade/rollback procedures before declaring the deployment Stable.
