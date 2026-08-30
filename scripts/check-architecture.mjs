import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const publicBoundaries = [
  ["packages/cli/src/index.ts", "CLI executable boundary"],
  ["packages/api/src/index.ts", "API public barrel"],
  ["packages/create-app/src/index.ts", "create-app executable boundary"],
  ["packages/notifications/src/index.ts", "client-safe notifications barrel"],
  ["packages/realtime/src/index.ts", "realtime public barrel"],
  ["packages/microhs/src/index.ts", "MicroHs public barrel"],
  ["packages/framework/src/index.ts", "framework public barrel"],
  ["packages/navigation/src/index.ts", "navigation public barrel"],
  ["packages/bridge/src/index.ts", "bridge public barrel"],
  ["packages/performance/src/index.ts", "performance public barrel"],
];

const lineCountBaselines = new Map([
  ["packages/cli/src/cli.ts", 1100],
  ["packages/notifications/src/server/providers.ts", 850],
  ["packages/notifications/src/server/token-store.ts", 500],
  ["packages/notifications/src/server/payloads.ts", 450],
  ["packages/realtime/src/client.ts", 650],
  ["packages/cli/src/guidance/catalog.ts", 600],
  [
    "packages/sdk-android/src/main/java/com/lynxship/sdk/android/LynxShipOtaClient.java",
    500,
  ],
  ["packages/realtime/src/client/core.ts", 400],
  ["packages/realtime/src/presence/client.ts", 500],
  ["packages/realtime/src/presence/state-store.ts", 260],
  ["packages/api/src/http-api.ts", 320],
  ["packages/cli/src/ios-build.ts", 120],
  ["packages/cli/src/plugins.ts", 120],
  ["packages/cli/src/ios-toolchain.ts", 120],
  ["packages/cli/src/android-toolchain.ts", 120],
  ["packages/cli/src/secure-store.ts", 220],
  ["packages/cli/src/android-build.ts", 300],
  ["packages/cli/src/guidance.ts", 280],
  ["packages/cli/src/plugins/operations.ts", 180],
  ["packages/cli/src/commands/build-execution.ts", 340],
  ["packages/cli/src/commands/project.ts", 280],
  ["packages/cli/src/commands/development.ts", 260],
]);

const failures = [];
const warnings = [];

for (const [file, description] of publicBoundaries) {
  try {
    await access(join(root, file));
  } catch {
    failures.push(`${file} is missing (${description})`);
  }
}

for (const [file, maximum] of lineCountBaselines) {
  const path = join(root, file);
  try {
    const source = await readFile(path, "utf8");
    const lines = source.split(/\r?\n/).length;
    if (lines > maximum) {
      failures.push(`${file} grew to ${lines} lines (maximum ${maximum})`);
    } else if (lines > maximum * 0.9) {
      warnings.push(
        `${file} is at ${lines}/${maximum} lines; plan the next extraction`,
      );
    }
  } catch {
    failures.push(`${file} is missing from the refactor baseline`);
  }
}

const serverSource = await readFile(
  join(root, "packages/notifications/src/server.ts"),
  "utf8",
);
if (serverSource.includes('from "./client.js"') === false) {
  failures.push(
    "notifications/server.ts must reuse the client-safe implementation instead of duplicating it",
  );
}

for (const warning of warnings)
  console.warn(`architecture warning: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures)
    console.error(`architecture error: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `architecture check passed: ${publicBoundaries.length} public boundaries and ${lineCountBaselines.size} growth baselines checked`,
  );
}
