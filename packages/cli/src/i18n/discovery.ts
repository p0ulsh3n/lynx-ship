import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { IntlCapability } from "@lynxship/i18n";
import { exists } from "../runtime/project.js";

interface ProjectPackageJson {
  readonly main?: unknown;
  readonly source?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const ENTRY_CANDIDATES = [
  "src/index.tsx",
  "src/index.ts",
  "src/main.tsx",
  "src/main.ts",
  "index.tsx",
  "index.ts",
] as const;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const CAPABILITY_PATTERNS: ReadonlyArray<readonly [IntlCapability, RegExp]> = [
  ["NumberFormat", /\bIntl\s*\.\s*NumberFormat\b/],
  ["DateTimeFormat", /\bIntl\s*\.\s*DateTimeFormat\b/],
  ["RelativeTimeFormat", /\bIntl\s*\.\s*RelativeTimeFormat\b/],
  ["ListFormat", /\bIntl\s*\.\s*ListFormat\b/],
  ["DisplayNames", /\bIntl\s*\.\s*DisplayNames\b/],
  ["Locale", /\bIntl\s*\.\s*Locale\b/],
  ["getCanonicalLocales", /\bIntl\s*\.\s*getCanonicalLocales\b/],
  ["Segmenter", /\bIntl\s*\.\s*Segmenter\b/],
  ["DurationFormat", /\bIntl\s*\.\s*DurationFormat\b/],
];

export async function readProjectPackage(
  root: string,
): Promise<ProjectPackageJson> {
  try {
    return JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as ProjectPackageJson;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`No package.json found in ${root}`);
    throw new Error(`Invalid package.json in ${root}`);
  }
}

export async function resolveEntryFile(
  root: string,
  requested?: string,
): Promise<string> {
  if (requested) {
    const file = resolve(root, requested);
    if (await exists(file)) return file;
    throw new Error(
      `The requested i18n entry file does not exist: ${requested}`,
    );
  }

  const packageJson = await readProjectPackage(root);
  if (typeof packageJson.source === "string") {
    const source = resolve(root, packageJson.source);
    if (await exists(source)) return source;
  }
  const conventional = await Promise.all(
    ENTRY_CANDIDATES.map(async (candidate) =>
      (await exists(resolve(root, candidate))) ? candidate : undefined,
    ),
  );
  const existing = conventional.filter(
    (candidate) => candidate !== undefined,
  ) as string[];
  const first = existing[0];
  if (existing.length === 1 && first) return resolve(root, first);
  if (existing.length > 1)
    throw new Error(
      `Multiple conventional Lynx entry files were found (${existing.join(", ")}). Pass --entry to choose one.`,
    );
  if (
    typeof packageJson.main === "string" &&
    SOURCE_EXTENSIONS.has(extname(packageJson.main))
  ) {
    const main = resolve(root, packageJson.main);
    if (await exists(main)) return main;
  }
  throw new Error(
    "Could not find the Lynx entry file. Pass `--entry src/index.tsx` to lynxship i18n setup.",
  );
}

export async function discoverLocales(root: string): Promise<string[]> {
  const directories = [join(root, "src", "locales"), join(root, "locales")];
  for (const directory of directories) {
    if (!(await exists(directory))) continue;
    const files = await readdir(directory, { withFileTypes: true });
    const locales = files
      .filter((file) => file.isFile() && extname(file.name) === ".json")
      .map((file) => basename(file.name, ".json"))
      .filter((locale) => /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(locale));
    if (locales.length > 0) return [...new Set(locales)].sort();
  }
  return ["en"];
}

export async function discoverIntlCapabilities(
  root: string,
): Promise<IntlCapability[]> {
  const files = await sourceFiles(root);
  const contents = await Promise.all(
    files.map((file) => readFile(file, "utf8").catch(() => "")),
  );
  const capabilities = new Set<IntlCapability>(["PluralRules"]);
  for (const [capability, pattern] of CAPABILITY_PATTERNS)
    if (contents.some((content) => pattern.test(content)))
      capabilities.add(capability);
  return [...capabilities];
}

async function sourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (!(await exists(directory))) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (SOURCE_EXTENSIONS.has(extname(entry.name))) result.push(file);
    }
  };
  await visit(join(root, "src"));
  return result;
}

export function projectRelative(root: string, file: string): string {
  return relative(root, file).replaceAll("\\", "/");
}
