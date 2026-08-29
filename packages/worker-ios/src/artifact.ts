import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { sha256 } from "@lynxship/contracts";

/** Hashes files and .app directories without including timestamps or host paths. */
export async function hashIosArtifact(path: string): Promise<string> {
  const metadata = await collect(path, path);
  return sha256(JSON.stringify(metadata));
}

type ArtifactEntry =
  | { readonly kind: "file"; readonly path: string; readonly hash: string }
  | {
      readonly kind: "symlink";
      readonly path: string;
      readonly target: string;
    };

async function collect(root: string, path: string): Promise<ArtifactEntry[]> {
  const info = await lstat(path);
  if (info.isSymbolicLink())
    return [
      {
        kind: "symlink",
        path: relative(root, path).replaceAll("\\", "/"),
        target: await readlink(path),
      },
    ];
  if (info.isFile())
    return [
      {
        kind: "file",
        path: relative(root, path).replaceAll("\\", "/"),
        hash: sha256(await readFile(path)),
      },
    ];
  if (!info.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const result: ArtifactEntry[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  ))
    result.push(...(await collect(root, join(path, entry.name))));
  return result;
}
