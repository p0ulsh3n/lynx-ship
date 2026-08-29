# Architecture evidence and repository rules

This reference is maintained for the LynxShip monorepo. External guidance was
checked on 2026-08-28. Re-check the linked primary sources when a toolchain
changes; do not treat this file as a substitute for current release notes.

## Evidence used

- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references)
  describe splitting a TypeScript program into smaller projects, improving
  build/editor performance and enforcing logical separation with `tsc -b`.
- [Node.js package documentation](https://nodejs.org/api/packages.html)
  recommends explicit `exports` entrypoints. It also warns that adding
  `exports` can be breaking if previously supported subpaths are omitted.
- [Nx module boundaries](https://nx.dev/docs/features/enforce-module-boundaries)
  documents dependency constraints and public root APIs as an automated way
  to prevent accidental cross-project coupling and cycles.
- [VS Code source organization](https://github.com/microsoft/vscode/wiki/source-code-organization)
  shows a large open-source TypeScript product organized into layers, runtime
  targets, services, contributions, and small environment-specific entrypoints.
- [Kubernetes staging packages](https://github.com/kubernetes/kubernetes/blob/master/staging/README.md)
  demonstrates keeping one authoritative implementation while exposing
  separately consumable packages, with explicit import restrictions.
- [EAS CLI source tree](https://github.com/expo/eas-cli/tree/main/packages/eas-cli/src)
  demonstrates domain-oriented CLI folders such as commands, build,
  credentials, submit, update, worker, simulator, and shared utilities.

## LynxShip rules derived from the evidence

### Public boundaries

The root `src/index.ts` of a package is a compatibility boundary, not a place
to put every implementation. New public features should be exported from a
named subpath when they have a different runtime or dependency set. Internal
modules should import their sibling implementation files, while consumers use
the package export.

### Layering

Use this dependency direction unless the package's domain requires a documented
exception:

```text
contracts/types -> pure domain -> application services -> adapters/providers
                                               ^
                                      entrypoint composition
```

CLI and HTTP entrypoints may depend on all lower layers, but lower layers must
not import CLI/UI/server startup code. Platform-specific modules depend on
portable interfaces, never the other way around.

### File and folder sizing

Line count is a signal, not a law. Start an extraction when a file contains
multiple independently testable responsibilities, multiple external clients,
more than one runtime boundary, repeated validation/serialization code, or a
command/router that owns business logic. Keep a cohesive algorithm together
when splitting it would only create indirection.

### Concrete decomposition blueprint

Prefer domain folders with explicit ownership over a flat collection of large
files. The repository's default targets are:

| Package family | Portable/core layer                       | Application layer                  | Integration layer                                       |
| -------------- | ----------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| CLI            | config, contracts, runtime ports          | commands, services, orchestration  | platform adapters, toolchains, terminal UI              |
| API            | contracts, validation, domain rules       | HTTP use cases and services        | repositories, R2/queue/auth providers, server bootstrap |
| realtime       | protocol, models, validation              | presence, receipts, activity state | WebSocket transport, native adapters, notifications     |
| notifications  | payload contracts and client registration | notification service/use cases     | FCM/APNs/Harmony providers, token store, persistence    |
| Expo/native    | JS contracts and hooks                    | config/plugin coordination         | Android/iOS modules, views, asset synchronization       |

The root barrel composes these layers; it does not become a second
implementation. A folder is justified by a responsibility or runtime boundary,
not by a desire to make the tree look busy. Avoid generic `helpers`, `misc`, or
`common` folders unless their ownership and dependency level are explicit.
Shared types belong in a low-level contract module; a provider must not be used
as another provider's type registry. Runtime dependencies such as roots,
repositories, clocks and process runners should be explicit parameters so an
isolated test can reproduce the module without the CLI's global state.
Platform diagnostics benefit from a further three-way seam: stable report
types, host probes, and inspection orchestration. Declarative guidance catalogs
should likewise be typed data modules, separate from command adaptation and
process execution. For protocol providers, a legacy file can remain a
compatibility barrel while each provider implementation lives in a named
submodule; this is especially useful when a file and folder share a basename.

### Size and seam review

Use 400, 600, and 800 lines as review signals, not mechanical limits. At 400
lines inspect responsibility count; at 600 document the extraction decision; at
800 stop adding unrelated behavior until a tested boundary exists. Exemptions
for generated code, fixtures, snapshots, and data tables must be named in the
architecture record. A thin barrel plus a 1,000-line private implementation is
not a completed refactor; the private implementation must still be divided at
real domain seams.

### Migration matrix for LynxShip

| Current risk                       | Required destination                                        | Compatibility requirement                            |
| ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| CLI mega-orchestrator              | command families, services, platform/toolchain adapters, UI | executable and existing command names unchanged      |
| mixed HTTP and business logic      | HTTP transport, services, repositories/providers            | existing routes and response contracts unchanged     |
| mixed realtime concerns            | core protocol plus domain modules and transport adapters    | existing client exports and event names unchanged    |
| server/client notification leakage | client contract plus server provider/service modules        | client entrypoint must remain credential-free        |
| Expo JS/native/config mixing       | JS API, config plugin, platform modules, assets             | existing Expo plugin and component imports unchanged |

For each row, move one seam at a time, run the focused boundary test, then run
the public-package smoke test before taking the next seam. Never use a private
cross-package source import to make the migration pass.

### Compatibility and migration

For a move, first preserve the old package import and executable. Then update
internal imports, declarations, exports, and tests. Only remove a compatibility
path in a planned breaking release with a migration note. Never solve a cycle
by reaching into another package's private `src` file.

### Architecture checks

At minimum, every package refactor should verify:

- package `exports` and TypeScript path mappings point at the same public
  boundary;
- no client bundle imports server-only providers or secrets;
- no platform adapter is required by a portable entrypoint;
- no new circular dependency is introduced;
- an old public import and executable still smoke-test successfully;
- focused tests, lint, formatting, typechecks, and release verification pass.

The architecture check should also flag new growth beyond an approved baseline,
unowned `utils` modules, client-to-server imports, platform imports from core,
provider-to-provider implementation coupling, and duplicate implementations of
the same contract. Warnings may be temporary;
each warning needs a documented owner, a safe extraction seam, and a removal
condition.

## Refactor record

For each significant extraction, add a short note to `docs/architecture.md`
or the package README explaining the responsibility of the new module and the
public import path. This gives future contributors a map without forcing them
to read the whole implementation.
