import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import {
  AssetPipelineError,
  DEFAULT_IGNORED_ASSET_NAMES,
  type AssetDiscoveryOptions,
  type AssetKind,
  type AssetManifest,
  type AssetRecord,
} from "./contracts.js";

const contentTypes: Record<string, string> = {
  ".aac": "audio/aac",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith(".." + sep) && !path.startsWith(sep));
}

function kindFor(path: string): AssetKind {
  const extension = extname(path).toLowerCase();
  if (
    [
      ".avif",
      ".bmp",
      ".gif",
      ".heic",
      ".ico",
      ".jpg",
      ".jpeg",
      ".png",
      ".svg",
      ".webp",
    ].includes(extension)
  )
    return "image";
  if ([".ttf", ".otf", ".woff", ".woff2"].includes(extension)) return "font";
  if ([".aac", ".flac", ".m4a", ".mp3", ".wav"].includes(extension))
    return "audio";
  if ([".mp4", ".mov", ".webm"].includes(extension)) return "video";
  if ([".css", ".scss"].includes(extension)) return "stylesheet";
  if ([".js", ".mjs", ".cjs", ".bundle", ".lynx"].includes(extension))
    return "bundle";
  if ([".json", ".xml", ".txt", ".map", ".wasm"].includes(extension))
    return "data";
  return "other";
}

function contentTypeFor(path: string): string {
  return (
    contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}

function ignored(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith(".*")
      ? name.startsWith(pattern.slice(0, -2))
      : name === pattern,
  );
}

async function hashFile(
  path: string,
): Promise<{ size: number; sha256: string }> {
  try {
    const data = await readFile(path);
    return {
      size: data.byteLength,
      sha256: createHash("sha256")
        .update(data.toString("latin1"), "latin1")
        .digest("hex"),
    };
  } catch (error) {
    throw new AssetPipelineError(
      "ASSET_FILE_READ",
      `Unable to read asset ${path}: ${String(error)}`,
    );
  }
}

export async function discoverAssets(
  options: AssetDiscoveryOptions,
): Promise<AssetRecord[]> {
  const root = resolve(options.root);
  try {
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new AssetPipelineError(
      "ASSET_ROOT_MISSING",
      `Asset root does not exist: ${root}`,
    );
  }
  const patterns = [...DEFAULT_IGNORED_ASSET_NAMES, ...(options.ignore ?? [])];
  const result: AssetRecord[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored(entry.name, patterns)) continue;
      const fullPath = resolve(directory, entry.name);
      if (!isInside(root, fullPath))
        throw new AssetPipelineError(
          "ASSET_PATH_ESCAPE",
          `Asset path escapes root: ${fullPath}`,
        );
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        const path = relative(root, fullPath).split(sep).join("/");
        if (options.include && !options.include.includes(path)) continue;
        const hash = await hashFile(fullPath);
        result.push({
          path,
          ...hash,
          kind: kindFor(path),
          contentType: contentTypeFor(path),
        });
      }
    }
  }

  await visit(root);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export function manifestHash(files: readonly AssetRecord[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        files.map(({ path, size, sha256, kind, contentType }) => ({
          path,
          size,
          sha256,
          kind,
          contentType,
        })),
      ),
    )
    .digest("hex");
}

export async function createAssetManifest(
  options: AssetDiscoveryOptions,
): Promise<AssetManifest> {
  const root = resolve(options.root);
  const files = await discoverAssets({ ...options, root });
  return { version: 1, root, files, sha256: manifestHash(files) };
}
