# @lynxship/tailwind-lynx

Validation and planning around the official `@lynx-js/tailwind-preset`. It does not claim every Tailwind utility is supported: verify against Lynx CSS compatibility data and the actual target backend.

## Usage and boundaries

Use the planner to inspect declared utilities before a build and keep the
official Tailwind preset as the renderer. Unsupported or backend-specific CSS
must be reported instead of silently emitted. This package does not install
Tailwind, replace Rspeedy, or guarantee that a Web-only utility works in every
Lynx renderer.
