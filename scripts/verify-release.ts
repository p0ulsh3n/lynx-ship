import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const required = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "README.md",
  "packages/api/package.json",
  "packages/api/dist/server.js",
  "packages/cli/package.json",
  "packages/microhs/package.json",
  "packages/microhs/dist/index.js",
  "packages/plugin-api/package.json",
  "packages/plugin-api/dist/index.js",
  "packages/plugin-api/README.md",
  "packages/create-app/package.json",
  "packages/create-app/dist/index.js",
  "packages/dashboard/package.json",
  "packages/dashboard/vite.config.ts",
  "packages/dashboard/dist/index.html",
  "docs/compatibility.md",
  "docs/status.md",
  "docs/acceptance-matrix.md",
  "docs/threat-model.md",
  "docs/plugin-ecosystem.md",
  "docs/operations.md",
  "schemas/lynxship.schema.json",
  "compose.yaml",
  "Dockerfile",
];
const missing = required.filter((file) => !existsSync(file));
if (missing.length) {
  console.error(`verify: missing ${missing.join(", ")}`);
  process.exit(1);
}
const compose = await readFile("compose.yaml", "utf8");
const dockerfile = await readFile("Dockerfile", "utf8");
if (
  !compose.includes("no-new-privileges:true") ||
  !compose.includes("cap_drop:") ||
  !compose.includes("postgres:") ||
  !compose.includes("redis:") ||
  !compose.includes("LYNXSHIP_STORAGE_DRIVER: r2") ||
  compose.includes("minio/minio:")
) {
  console.error(
    "verify: compose self-host profile or security baseline is incomplete",
  );
  process.exit(1);
}
if (
  !dockerfile.includes("USER node") ||
  !dockerfile.includes("pnpm install --frozen-lockfile")
) {
  console.error(
    "verify: Dockerfile must use a non-root runtime and frozen dependencies",
  );
  process.exit(1);
}
console.log(
  `verify: ${required.length} release inputs present; container security checks passed`,
);
