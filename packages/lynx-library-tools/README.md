# @lynxship/lynx-library-tools

Authoring and validation helpers for official Lynx native libraries.

This package does not replace Lynx Autolink or `lynx-autolink-codegen`. It
validates a library's `lynx.lib.json`, verifies platform source paths stay
inside the package, and creates an explicit codegen command plan. Process
execution is injected by the caller so validation remains safe and testable.

It also creates an explicit command plan for the official `npm create
lynx-library` scaffold (or the equivalent `pnpm`/`yarn` command). The plan
validates package names, selected official features/platforms and root
containment before a caller executes it; LynxShip does not replace the
official generator.

`inspectLynxLibrary` also checks the package metadata required for a
publishable native library: a valid lowercase npm name and a non-empty
`scripts.codegen` entry. It recognizes the official Android, iOS, HarmonyOS,
Lynxtron, macOS and Windows source targets. Unknown platform keys and native
paths outside the package are reported as validation issues instead of being
silently ignored.

For a library package, `createLibraryWorkflowPlan` creates an ordered,
injected workflow for `codegen`, `build`, `test`, the consumer `example` smoke
script and `pack --dry-run`. `runLibraryWorkflow` executes only the commands
declared by the caller, stops on the first non-zero exit code and never uploads
or creates a publish release.

The supported manifest contract follows the official Lynx documentation:
<https://lynxjs.org/guide/autolink.html>
