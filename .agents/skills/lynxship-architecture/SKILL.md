---
name: lynxship-architecture
description: Maintain and extend LynxShip packages as cohesive, testable modules while preserving public APIs, package boundaries, and release behavior.
metadata:
  short-description: Production-ready package decomposition and architecture guardrails
---

# LynxShip package architecture

Use this skill for every new LynxShip package and for changes to existing
packages. It keeps large entrypoints, mixed runtime and platform
responsibilities, duplicated client/server logic, unclear public exports, and
changes that risk breaking consumers under control. The goal is not to make
files small for their own sake: each module should have one reason to change,
a stable dependency direction, an explicit public API, and focused tests.

## First read

Read these repository references before editing:

- [references/architecture-patterns.md](references/architecture-patterns.md)
  for the evidence-backed rules and source links;
- `docs/architecture.md` for the current package map;
- the package's tests, `package.json`, and TypeScript config before moving code.

## Non-negotiable rules

1. Preserve the published API first. Keep a thin `src/index.ts` barrel or
   compatibility adapter when moving an implementation. Update `exports`,
   TypeScript paths, declarations, tests, and bin entries together.
2. Split by responsibility and change-rate, not arbitrary line counts. Typical
   boundaries are `commands`, `services`, `adapters`, `providers`, `runtime`,
   `platform`, `config`, `ui`, and `utils`.
3. Keep dependency direction explicit: contracts and pure domain code do not
   import adapters, process runners, UI, or platform SDKs. Adapters depend on
   contracts; entrypoints compose modules.
4. Do not create a shared module merely to hide a cycle. Move the genuinely
   shared contract to the lowest layer or combine the modules when the domain
   is actually one cohesive unit.
5. One implementation per concern. Client-safe code must not be duplicated in
   server bundles; native/platform code must not leak into portable packages.
6. Keep environment-specific implementations behind an explicit adapter or
   factory. Never select a platform through import-time side effects.
7. Use package `exports` as the public boundary. Internal files are private
   unless deliberately exported; preserve every existing supported subpath
   before introducing stricter encapsulation.
8. Every moved behavior needs focused tests at the new boundary and at least
   one compatibility test through the old public import or executable.
9. Refactors must be incremental and reversible. Move code without changing
   behavior first, then make semantic changes in separate commits.
10. A module is not "done" because it is shorter. It is done when ownership,
    dependencies, API surface, tests, docs, and generated output are clear.
11. Shared contracts and types must live in a deliberately low-level `types`
    or `contracts` module. Do not import a type from a sibling provider's
    implementation just because it is convenient.
12. Runtime context must be explicit. Pass project roots, environment options,
    repositories, clocks, process runners, and network clients into modules;
    do not hide them in mutable module globals.
13. A subdirectory index is a boundary, not an implementation dump. It may
    re-export stable symbols, but behavior belongs in domain files and the
    barrel must not reintroduce cycles or duplicate logic.
14. Separate pure planning from side effects. Argument parsing, validation,
    capability decisions, and command construction should be testable without
    spawning processes, writing credentials, or contacting a provider.

## Target structure

Use the smallest structure that reflects the package's real domains. Do not
create empty folders in advance, but when a responsibility exists, give it a
named home instead of growing a single `src/index.ts` or `src/cli.ts`.

Preferred layouts for this repository are:

```text
CLI
src/index.ts                 public barrel / executable bridge
src/commands/                one command family per module
src/services/                orchestration and use cases
src/platform/<target>/       Android, iOS, HarmonyOS, web, desktop adapters
src/toolchains/              detected tools and build toolchains
src/config/                  config loading and normalization
src/ui/                      terminal output, prompts, QR and progress
src/runtime/                 process, filesystem, network and environment ports

API/control plane
src/index.ts                 public API barrel
src/http/                    transport, routes and request translation
src/services/                business use cases
src/repositories/            persistence interfaces and implementations
src/providers/               R2, queues, auth and external service adapters
src/runtime/                 server bootstrap, telemetry and configuration

Client/runtime libraries
src/index.ts                 portable public API
src/core/                    protocol, contracts and pure validation
src/<domain>/                presence, receipts, activity, notifications, etc.
src/adapters/                platform or transport implementations
src/server/                  server-only entrypoints, when applicable

Expo/native packages
src/index.ts                 JS public API
src/config/                  config plugin and app configuration
src/js/                      JavaScript-facing hooks and components
src/platform/android/        Android bridge and view/module adapter
src/platform/ios/            iOS bridge and view/module adapter
src/assets/                  bundle and asset synchronization
```

The names may vary when the domain calls for it, but the separation must stay
visible. A `utils` folder is not a default dumping ground: every utility must
have a stable domain owner or be moved to the lowest layer that genuinely
shares it.

## Safe extraction procedure

For every large-file decomposition, follow this order:

1. Snapshot the current public exports, package `exports`, bin entries,
   TypeScript paths, fixtures, and behavior tests.
2. Inventory the file by responsibility, runtime, external dependency, and
   change rate. Mark each block with its intended destination before moving it.
3. Create the destination module with one cohesive responsibility. Move the
   implementation; do not rewrite behavior during the same step.
4. Update internal imports to use the new module. Keep the old public path as a
   barrel or compatibility adapter.
5. Update package exports, declaration output, path mappings, and executable
   entries together. Check both source and built-package resolution.
6. Add a focused test for the new module and a compatibility smoke test through
   the previous public import or command.
7. Run formatting, architecture checks, focused tests, typecheck, and the
   affected package build before starting the next extraction.
8. Remove duplicate code only after the new path is exercised. Search for the
   old symbol and stale imports before declaring the move complete.
9. Update the package README or `docs/architecture.md`, then lower or replace
   any temporary size baseline with the new module boundary.

Never combine a structural move, a public API redesign, and a behavior change
without separate tests and a migration note. If a file must remain large, add
the reason to the refactor record and identify the next safe seam.

## Size guardrails

Line count is not a correctness metric, but it is an effective review signal:

- over 400 lines: review whether the file has more than one responsibility;
- over 600 lines: require an extraction decision in the refactor record;
- over 800 lines: do not add another domain to the file without first defining
  and testing a boundary;
- generated code, fixtures, snapshots, and intentionally data-heavy tables are
  exempt when explicitly marked.

These are review thresholds, not a rule to split cohesive algorithms into
meaningless wrappers. The architecture checker may use a temporary higher
baseline during migration, but the baseline must not hide new growth and must
have an owner and removal condition.

## Definition of done

A package extraction is complete only when all of the following are true:

- the public root and every supported subpath still resolve;
- package `exports`, bin entries, TypeScript paths, and declarations agree;
- each module has one clear owner and dependency direction is acyclic;
- portable/client modules do not pull in server secrets, native SDKs, or CLI
  startup side effects;
- platform selection happens through an explicit adapter or capability;
- duplicate implementations and stale private imports are removed;
- focused tests cover the new boundary and compatibility tests cover the old;
- package build, typecheck, lint, formatting, and release verification pass;
- documentation describes the source tree and migration implications;
- no generated output, credentials, temporary archives, or machine paths were
  accidentally included.

Passing tests alone is not enough: a thin barrel with an oversized hidden
implementation is an intermediate step, not the final architecture.

## Lessons captured during migrations

- When moving code out of a closure, pass every value that was previously
  captured (especially the project root) and add a test for an isolated
  temporary project. An omitted context argument can surface only as a vague
  filesystem error.
- When splitting providers, create a shared contract module first, then make
  each provider depend on it. Provider A must not become the accidental base
  class or type registry for provider B.
- Keep public compatibility at the old path while internal callers move to the
  new path. This permits package-by-package migration and makes failures easy
  to bisect.
- Treat generated `dist` output as a verification artifact, not as a second
  source tree. Build it from the new source after each extraction and do not
  hand-edit generated declarations or JavaScript.
- Prefer a small number of meaningful subfolders over a flat list of files,
  but stop when a further split would only move a tightly coupled algorithm
  into wrappers with no independent owner or test seam.
- For platform diagnostics, keep stable report types, host probes, and the
  inspection orchestration separate. Probes may read the host, but must not
  own command routing or public presentation.
- Move declarative catalogs (for example error-to-command guidance) out of
  executable resolution code. A catalog may remain data-heavy, but it must
  have a typed schema and no process, filesystem, or network side effects.
- For native provider refactors, split by external protocol (FCM, APNs,
  Huawei, store APIs) and keep the old provider module as a compatibility
  barrel. This preserves imports while making each credential and transport
  lifecycle independently testable.
- When a subfolder has a compatibility filename collision with its parent
  (such as `providers.ts` and `providers/`), use the file only as a barrel and
  keep all implementations below the folder; document the distinction.

## Repository architecture workflow

Use this sequence for every new package or structural change:

1. Preserve public barrels and package boundaries.
2. Finish high-risk runtime splits such as notifications and realtime.
3. Extract CLI command families, services, platform adapters, toolchains, and
   terminal UI from the historical orchestrator.
4. Apply the same boundaries to API/control-plane and Expo/native packages.
5. Add package-level architecture fixtures and CI checks for exports, cycles,
   forbidden imports, size growth, and built-package smoke tests.

Keep remaining seams explicit instead of hiding unrelated responsibilities
behind a barrel. A compatibility barrel is a public boundary, not a substitute
for cohesive private modules.

## Refactor review template

Record this information in the PR or architecture note:

```text
Package/domain:
Before: responsibilities, public paths, largest files:
New modules and ownership:
Dependency direction:
Compatibility paths preserved:
Exports/paths/bin changes:
Focused and full verification:
Known large files and removal condition:
```

## Workflow

1. Inventory source files, exports, imports, entrypoints, tests, generated
   artifacts, and the largest modules. Record the current behavior.
2. Draw the package's dependency direction and identify the highest-risk
   responsibility mixtures. Do not start with cosmetic renames.
3. Create a thin public barrel and move one cohesive domain at a time. Keep
   compatibility shims until the next intentional breaking release.
4. Add or update package subpath exports and TypeScript path mappings only
   after the source move is complete.
5. Add architecture checks: forbidden imports, duplicate implementations,
   circular dependencies, public-export smoke tests, and package-size or
   generated-file checks where useful.
6. Run focused tests, then formatting/lint, workspace typechecks, root
   typecheck, package builds, and the full release verification command.
7. Review the diff for accidental API changes, stale paths, copied logic,
   generated artifacts, secrets, and documentation drift.

## Package-specific routing

- CLI: keep parsing and executable startup thin; command handlers compose
  domain services and platform adapters. Shared guidance belongs in a pure
  module, not inside a command switch.
- API: routes validate and translate requests; services own business rules;
  repositories/providers own persistence and external APIs; server startup is
  separate from the HTTP route graph.
- Notifications/realtime: keep client-safe protocol types and transports
  separate from provider credentials, server persistence, and native adapters.
- Build providers: keep target capability detection, orchestration state, and
  platform toolchains separate. A provider must be replaceable in tests.
- Expo/native packages: keep config plugins, JS API, platform modules, and
  asset/bundle synchronization separate. Never require native code in the JS
  entrypoint.

## Required verification report

When complete, report the modules moved, preserved public entrypoints, tests
and checks run, package exports changed, and any remaining intentionally large
or planned modules. Do not claim that a refactor makes a provider production
ready unless a real provider or platform integration was exercised.
