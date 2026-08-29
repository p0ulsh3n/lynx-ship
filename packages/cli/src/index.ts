#!/usr/bin/env node

// Keep the executable entrypoint intentionally small. Command orchestration
// lives in cli.ts so the package entrypoint is not coupled to every command
// implementation and can remain a stable binary boundary.
import "./cli.js";
