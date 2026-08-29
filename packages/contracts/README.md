# @lynxship/contracts

Shared, platform-neutral LynxShip contracts: platform and build identifiers,
job/result DTOs, worker records, errors, canonical serialization, hashing and
validation helpers.

Keep this package free of CLI, database, cloud and native imports. It is the
stable boundary used by the client packages and server-side services.

## Supported scope

The contracts cover Android, iOS, HarmonyOS, Web and Desktop build records,
plus shared OTA, worker, submission and tenant DTOs. They are runtime-neutral:
mobile applications may depend on the pure types and validation helpers, while
database, queue, storage and provider implementations belong to server-side
packages.

## Security

`canonicalize`, `sha256` and `assert` provide deterministic integrity helpers;
they are not a secret manager or a replacement for platform signing. Never put
private keys, provider credentials or bearer tokens in a contract payload.
