# @lynxship/signing

Platform-neutral signing and verification primitives for LynxShip OTA
manifests, keyrings, deltas and SDK-facing compatibility checks.

Private signing keys remain outside application bundles and should live in a
secret manager or CI secret store. Native Android/iOS store signing is handled
by the platform toolchains and is not implemented by this package.

## Usage and key custody

Use the signing service to produce and verify canonical OTA manifests and
content hashes. Keep private keys in a secret manager or CI-protected signing
process and expose only public keys to application hosts. Key rotation and
revocation are explicit operations; a successful local verification does not
replace Apple, Google or platform release validation.
