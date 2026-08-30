# @lynxship/auth

Private server-side token and organization authorization primitives. The
`TokenManager` stores only token digests, enforces scopes and project/tenant
ownership, supports expiry and revocation, and can be persisted by the API.

Worker automation uses separate least-privilege scopes: `worker:manage` for
registration and lifecycle control, `worker:heartbeat` for liveness, and
`worker:report` for build reports. A machine token may include `workerId` to
bind it to one registered worker; the API rejects reports with a different
worker identity. Existing records without `workerId` remain readable for
backward-compatible migrations, but production agents should use a bound,
short-lived token.

Secrets must be generated and stored by the control plane or a secret manager;
this package is not a client SDK and must never be bundled into a mobile app.
