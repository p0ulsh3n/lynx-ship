# LynxShip repository engineering rules

These rules apply to every new package and every change under this repository.
They are part of the repository contract, not optional refactoring advice.

## Package architecture

- Keep the public entry point thin. Export the supported API from `src/index.ts`
  (or the package's documented native/dashboard entry point) and keep internal
  implementation behind cohesive modules.
- Split `src/` by responsibility: contracts/types, validation, discovery,
  planning, effects/adapters, persistence, platform providers, and UI/CLI
  presentation should not become one large file.
- Put shared contracts and pure logic below provider/platform adapters. Do not
  make the core depend on Android, iOS, cloud, database, or CLI side effects.
- Inject runtime context and dependencies explicitly. Do not introduce mutable
  module-global state, hidden environment reads, or import-time side effects.
- Separate planning/validation from execution. A dry run must not upload,
  mutate credentials, write native files, or change remote state.
- Preserve public import paths, command names, configuration keys, and result
  shapes. When moving code, retain a compatibility barrel or adapter and add a
  regression test.

## File size and maintainability

- Aim for cohesive files below 400 lines.
- A file above 400 lines requires a documented reason; 600 lines is a review
  threshold and 800 lines requires an explicit architecture decision.
- Declarative catalogs, generated files, low-level state machines, and public
  facades may be exceptions only when their responsibility is genuinely single
  and the architecture check records the reason and growth budget.
- Do not hide unrelated responsibilities in a file merely to avoid creating a
  meaningful subdirectory.

## Required work for every new package or feature

- Define the public API and package boundary before implementation.
- Add focused unit tests for pure logic and integration tests for filesystem,
  native, network, storage, or process effects.
- Do not leave unused imports, locals, parameters, dead branches, or placeholder
  code. Do not silence these diagnostics with broad compiler or lint disables;
  remove the declaration or connect it to a tested behavior.
- Document setup, supported platforms, limitations, security assumptions, and
  the public usage path in the package README and relevant project docs.
- Update the workspace, build, typecheck, lint, architecture baselines, and CI
  only when the new package actually requires those integrations.
- Run `pnpm check` before opening a pull request. This runs formatting, the
  architecture and structure checks, linting, builds, and the test suite. CI
  runs the same gate through `pnpm verify`.

## Refactoring

For package architecture work or a substantial restructuring, follow
`.agents/skills/lynxship-architecture/SKILL.md`. The skill is the
detailed playbook; this file is the persistent repository rule that remains
visible for future package work.

Do not change behavior, public APIs, release metadata, or package boundaries
without a regression test and an explicit migration/compatibility path.
