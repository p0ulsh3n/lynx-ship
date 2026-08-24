import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { hashJson, sha256 } from "@lynxship/contracts";

const defaultIgnored = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".lynxship",
]);

export interface SourceFile {
  path: string;
  hash: string;
  size: number;
}

export async function createSourceManifest(
  root: string,
  options: { ignored?: Set<string> } = {},
): Promise<{ version: number; files: SourceFile[]; hash: string }> {
  const files: SourceFile[] = [];
  const ignored = options.ignored ?? defaultIgnored;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else {
        const data = await readFile(path);
        files.push({
          path: relative(root, path).replaceAll("\\", "/"),
          hash: sha256(data),
          size: data.length,
        });
      }
    }
  }

  await visit(root);
  return { version: 1, files, hash: hashJson(files) };
}
