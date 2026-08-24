# Threat model (foundation)

Trust boundaries are explicit: CLI and workers are untrusted clients; the control plane owns authorization; object storage is an untrusted blob transport; signing keys are a separate high-value boundary.

The CLI stores Cloudflare R2, Android signing, Google Play and App Store
Connect secrets in a global LynxShip credential store. On Windows the values
are protected with Windows DPAPI; on macOS they are stored in the macOS
Keychain; on Linux the CLI uses the freedesktop Secret Service through
`secret-tool` when available. Headless Linux without a Secret Service uses an
owner-only mode-600 fallback file and should use CI secret injection for
unattended production environments. Secrets are entered without terminal echo,
are never written to `lynxship.json`, and are not sent to the control plane.
Google Play uploads use short-lived OAuth access tokens derived from the
encrypted service-account key. App Store Connect uploads write the decrypted
`.p8` key only to a temporary owner-only Transporter directory and remove it
after the upload process exits. R2 downloads use short-lived presigned GET URLs;
those URLs are bearer
tokens and must be treated as shareable secrets until expiry. No storage
credentials or permanent public bucket URL are printed by the CLI.

Current controls:

- Tokens are hashed and scoped; role checks are centralized.
- OTA manifests use canonical JSON and Ed25519 signatures. Native executable OTA is blocked.
- Secret values are encrypted with AES-256-GCM in the local vault and are never returned by inspection.
- Build jobs have explicit transitions, attempts and provider boundaries.
- Content-addressed storage prevents accidental overwrite of an existing object.
- Webhook signatures bind a timestamp and exact body.

Production gates still required: KMS/HSM-backed keys, Postgres row-level ownership checks, network isolation, worker sandboxing, rate limits, dependency scanning, audit persistence, backup restore drills and external policy review.
