# Platform verification matrix

Run the narrowest relevant check first, then the complete repository checks.

| Change                     | Required evidence                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Contracts or serialization | Focused contract tests, canonical/hash tests, `pnpm check`                                                                 |
| API/auth/tenant route      | API tests for success, validation, unauthorized, cross-tenant and rate-limit paths; `pnpm check`                           |
| PostgreSQL or migration    | Repository tests, migration tracker tests, persistence restart test, `pnpm verify`                                         |
| Redis queue or worker      | Lease, heartbeat, retry, dead-letter, drain and revocation tests; live Redis check when claiming production readiness      |
| R2/storage                 | Exact-byte upload/download, hash, expiry and redaction tests; live R2 check with non-production credentials when available |
| Signing/OTA                | Manifest signature, key rotation, runtime fingerprint, native-change block, staged activation and rollback tests           |
| Dashboard                  | `pnpm --filter @lynxship/dashboard build`, route/query contract checks and unauthorized/loading/error states               |
| CI or security             | YAML review, least-privilege permissions, secret scan, `pnpm verify` and a clean-runner check                              |
| Worker implementation      | Real executor, lease recovery and platform integration evidence; shared registry tests alone are insufficient              |

## Repository gates

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm verify
pnpm --filter @lynxship/dashboard build
pnpm exec tsc -p tsconfig.json --noEmit
git diff --check
```

The current test suites include API health/build contracts, auth scopes,
persistent state, artifact integrity, OTA eligibility, queue recovery,
provider contracts, vault redaction, tenant ownership, rollout health,
migrations and worker lifecycle. Confirm the test names in the repository
before citing them as evidence.

## Evidence labels

Use precise labels: `contract-only`, `bundle-built`,
`native-compiled-unsigned`, `locally-signed-and-verified`, `uploaded-to-r2`,
`submitted-to-store`, or `live-worker-verified`. Never collapse a mock
provider result into a live external integration result.
