import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packagesRoot = join(root, "packages");
const testRoot = join(root, "test");
const failures = [];
const broadNativeRoots = new Set(["android", "ios", "harmony"]);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    failures.push(`${path} is not valid JSON: ${error.message}`);
    return null;
  }
}

async function packageTestMentions(name, directoryName) {
  if (!(await exists(testRoot))) return false;
  const files = await readdir(testRoot, { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile() || !/\.(?:c|m)?tsx?$/.test(file.name)) continue;
    const source = await readFile(join(testRoot, file.name), "utf8");
    if (source.includes(name) || source.includes(directoryName)) return true;
  }
  return false;
}

const entries = await readdir(packagesRoot, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const directory = join(packagesRoot, entry.name);
  const manifestPath = join(directory, "package.json");
  if (!(await exists(manifestPath))) {
    failures.push(`${directory} is missing package.json`);
    continue;
  }
  const manifest = await readJson(manifestPath);
  if (!manifest) continue;

  if (manifest.private === true) {
    const label = manifest.name ?? entry.name;
    if (!(await exists(join(directory, "README.md"))))
      failures.push(`${label}: README.md is required for private packages`);
    if (!manifest.scripts?.build && !manifest.scripts?.typecheck)
      failures.push(`${label}: build or typecheck script is required`);
    if (!(await packageTestMentions(label, entry.name)))
      failures.push(`${label}: no root contract test references this package`);
    continue;
  }

  const label = manifest.name ?? entry.name;
  if (typeof manifest.name !== "string" || manifest.name.trim() === "")
    failures.push(`${label}: package name is required`);
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+/.test(manifest.version)
  )
    failures.push(`${label}: published packages need a semantic version`);
  if (manifest.license !== "MIT")
    failures.push(`${label}: published packages must declare the MIT license`);
  if (!manifest.repository || typeof manifest.repository.url !== "string")
    failures.push(`${label}: repository metadata is required`);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0)
    failures.push(`${label}: published files must be explicit`);
  for (const file of manifest.files ?? []) {
    if (typeof file !== "string") continue;
    const normalized = file.replaceAll("\\", "/");
    if (
      broadNativeRoots.has(normalized) ||
      [...broadNativeRoots].some(
        (rootName) =>
          normalized === `${rootName}/*` || normalized === `${rootName}/**`,
      )
    ) {
      failures.push(
        `${label}: published files must not include the broad native root ${file}; list source files or source directories explicitly`,
      );
    }
  }
  if (!(await exists(join(directory, "README.md"))))
    failures.push(`${label}: README.md is required`);

  const nativePackage = (
    await Promise.all(
      [
        "Package.swift",
        "build.gradle",
        "lynxship-ota.podspec",
        "lynxship-expo.podspec",
      ].map((file) => exists(join(directory, file))),
    )
  ).some(Boolean);
  const hasEntry =
    (await exists(join(directory, "src", "index.ts"))) ||
    typeof manifest.main === "string" ||
    manifest.exports !== undefined ||
    manifest.bin !== undefined ||
    nativePackage;
  if (!hasEntry) failures.push(`${label}: public entry point is missing`);
  if (
    !manifest.scripts?.build &&
    !manifest.scripts?.typecheck &&
    !nativePackage
  )
    failures.push(`${label}: build or typecheck script is required`);
  if (!(await packageTestMentions(label, entry.name)))
    failures.push(`${label}: no root contract test references this package`);
}

if (failures.length > 0) {
  for (const failure of failures)
    console.error(`package contract error: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "package contract check passed: all workspace packages have required docs, build/typecheck scripts and test coverage; public packages also have publish metadata",
  );
}
