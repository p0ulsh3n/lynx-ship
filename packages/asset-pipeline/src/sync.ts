import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import {
  AssetPipelineError,
  type AssetManifest,
  type AssetSyncPlan,
  type AssetSyncPlanEntry,
} from "./contracts.js";
import { validateAssetManifest } from "./manifest-validation.js";

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith(".." + sep) && !path.startsWith(sep));
}

export function createAssetSyncPlan(
  manifest: AssetManifest,
  targetRoot: string,
): AssetSyncPlan {
  validateAssetManifest(manifest, { verifyHash: false });
  const sourceRoot = resolve(manifest.root);
  const destinationRoot = resolve(targetRoot);
  const files: AssetSyncPlanEntry[] = manifest.files.map((asset) => {
    const source = resolve(sourceRoot, asset.path);
    const target = resolve(destinationRoot, asset.path);
    if (!isInside(sourceRoot, source))
      throw new AssetPipelineError(
        "ASSET_PATH_ESCAPE",
        `Asset source escapes root: ${asset.path}`,
      );
    if (!isInside(destinationRoot, target))
      throw new AssetPipelineError(
        "ASSET_TARGET_ESCAPE",
        `Asset target escapes root: ${asset.path}`,
      );
    return { ...asset, source, target };
  });
  return { sourceRoot, targetRoot: destinationRoot, files };
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256")
    .update(data.toString("latin1"), "latin1")
    .digest("hex");
}

export async function applyAssetSyncPlan(plan: AssetSyncPlan): Promise<void> {
  const previous = new Map<string, Buffer | undefined>();
  try {
    for (const entry of plan.files) {
      const sourceHash = await sha256File(entry.source);
      if (sourceHash !== entry.sha256)
        throw new AssetPipelineError(
          "ASSET_HASH_MISMATCH",
          `Asset source changed after manifest creation: ${entry.path}`,
        );
      previous.set(entry.target, await readExisting(entry.target));
      await mkdir(dirname(entry.target), { recursive: true });
      await copyFile(entry.source, entry.target);
      const actual = await sha256File(entry.target);
      if (actual !== entry.sha256)
        throw new AssetPipelineError(
          "ASSET_HASH_MISMATCH",
          `Asset hash mismatch after copy: ${entry.path}`,
        );
    }
  } catch (error) {
    await Promise.all(
      [...previous.entries()].map(async ([path, data]) => {
        if (data === undefined) await rm(path, { force: true });
        else
          await writeFile(path, data.toString("latin1"), {
            encoding: "latin1",
          });
      }),
    );
    if (error instanceof AssetPipelineError) throw error;
    throw new AssetPipelineError(
      "ASSET_FILE_READ",
      `Asset synchronization failed: ${String(error)}`,
    );
  }
}

async function readExisting(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
