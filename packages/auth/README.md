# @lynxship/auth

Private server-side token and organization authorization primitives. The
`TokenManager` stores only token digests, enforces scopes and project/tenant
ownership, supports expiry and revocation, and can be persisted by the API.

Secrets must be generated and stored by the control plane or a secret manager;
this package is not a client SDK and must never be bundled into a mobile app.
