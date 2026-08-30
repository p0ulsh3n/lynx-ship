import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  materializeSourceSnapshot,
  type SourceSnapshot,
} from "@lynxship/build-orchestrator";
import type { BuildSourceReference } from "@lynxship/contracts";

export interface WorkerSourceInput {
  readonly reference: BuildSourceReference;
  readonly bytes: Buffer;
}

export interface WorkerSourceWorkspace {
  readonly path: string;
  readonly snapshot: SourceSnapshot;
  cleanup(): Promise<void>;
}

export interface WorkerSourceWorkspaceOptions {
  /** Parent directory reserved for disposable build workspaces. */
  readonly parentDirectory?: string;
}

/**
 * Materializes one verified source object into a private disposable directory.
 * The executor must finish reading and uploading its artifact before cleanup.
 */
export async function materializeWorkerSource(
  source: WorkerSourceInput,
  options: WorkerSourceWorkspaceOptions = {},
): Promise<WorkerSourceWorkspace> {
  const parent = resolve(
    options.parentDirectory ??
      join(
        process.env.TMPDIR ?? process.env.TEMP ?? tmpdir(),
        "lynxship-build-workspaces",
      ),
  );
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700).catch(() => undefined);
  const path = await mkdtemp(join(parent, "build-"));
  try {
    const materialized = await materializeSourceSnapshot(
      source.bytes,
      source.reference,
      path,
    );
    await chmod(path, 0o700).catch(() => undefined);
    let cleaned = false;
    return {
      path: materialized.root,
      snapshot: materialized.snapshot,
      async cleanup(): Promise<void> {
        if (cleaned) return;
        cleaned = true;
        await rm(path, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
