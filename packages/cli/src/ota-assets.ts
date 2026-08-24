import { readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";

function normalized(value: string): string {
  return value.split(sep).join("/");
}

async function discover(directory: string, result: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if ([".rsbuild", ".rspeedy", "node_modules"].includes(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await discover(file, result);
      continue;
    }
    if (
      entry.isFile() &&
      [".bundle"].includes(extname(entry.name)) &&
      entry.name.includes("lynx")
    )
      result.push(file);
  }
}

export async function otaAssetPaths(
  root: string,
  explicit: string | null,
): Promise<string[]> {
  if (explicit)
    return explicit
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => resolve(root, value));
  const dist = join(root, "dist");
  const discovered: string[] = [];
  await discover(dist, discovered);
  if (discovered.length > 0) return discovered.sort();
  return [join(dist, "main.lynx.bundle")];
}

export function otaAssetName(root: string, file: string): string {
  const dist = resolve(root, "dist");
  const relativePath = relative(dist, resolve(file));
  if (!relativePath || relativePath.startsWith(`..${sep}`))
    return basename(file);
  return normalized(relativePath);
}
