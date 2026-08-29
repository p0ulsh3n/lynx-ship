#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { main } from "./create.js";

export * from "./create.js";

function isCliEntrypoint(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) return false;

  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(invokedPath) === realpathSync(modulePath);
  } catch {
    return resolve(invokedPath) === resolve(modulePath);
  }
}

if (isCliEntrypoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nx ${message}`);
    process.exitCode = 1;
  });
}
