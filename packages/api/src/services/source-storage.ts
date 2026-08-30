import {
  decodeSourceSnapshot,
  SOURCE_SNAPSHOT_CONTENT_TYPE,
  verifySourceObject,
} from "@lynxship/build-orchestrator";
import { sha256, type BuildSourceReference } from "@lynxship/contracts";
import { FileStorage, S3ObjectStorage } from "@lynxship/storage";
import type { RuntimeBackends } from "../app.js";

export interface BuildSourceStorage {
  store(content: Buffer): Promise<BuildSourceReference>;
  load(reference: BuildSourceReference): Promise<Buffer>;
  plan(reference: BuildSourceReference): Promise<BuildSourceUploadPlan>;
  complete(reference: BuildSourceReference): Promise<BuildSourceReference>;
}

export interface BuildSourceUploadPlan {
  source: BuildSourceReference;
  upload: {
    method: "PUT";
    url: string;
    headers: { "content-type": string };
    expiresAt: string;
  };
}

export function createBuildSourceStorage(
  runtime: RuntimeBackends | undefined,
  artifactStore: FileStorage,
): BuildSourceStorage {
  return {
    async store(content): Promise<BuildSourceReference> {
      const snapshot = decodeSourceSnapshot(content);
      const reference = sourceReference(content, snapshot.files.length);
      if (runtime?.storageStore instanceof S3ObjectStorage) {
        await runtime.storageStore.put(
          reference.key,
          content,
          SOURCE_SNAPSHOT_CONTENT_TYPE,
        );
      } else {
        const stored = await artifactStore.put(content, {
          contentType: SOURCE_SNAPSHOT_CONTENT_TYPE,
        });
        reference.key = stored.key;
      }
      return reference;
    },

    async load(reference): Promise<Buffer> {
      if (runtime?.storageStore instanceof S3ObjectStorage)
        return runtime.storageStore.get(reference.key);
      return artifactStore.get(reference.hash);
    },

    async plan(reference): Promise<BuildSourceUploadPlan> {
      if (!(runtime?.storageStore instanceof S3ObjectStorage))
        throw Object.assign(
          new Error(
            "Direct source upload requires an S3-compatible object storage backend",
          ),
          { code: "SOURCE_DIRECT_UPLOAD_UNAVAILABLE", statusCode: 409 },
        );
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      return {
        source: reference,
        upload: {
          method: "PUT",
          url: await runtime.storageStore.presignPut(
            reference.key,
            reference.contentType,
          ),
          headers: { "content-type": reference.contentType },
          expiresAt,
        },
      };
    },

    async complete(reference): Promise<BuildSourceReference> {
      const content = await this.load(reference);
      verifySourceObject(content, reference);
      return reference;
    },
  };
}

function sourceReference(
  content: Buffer,
  fileCount: number,
): BuildSourceReference {
  const hash = sha256(content);
  return {
    key: `sources/${hash}`,
    hash,
    size: content.length,
    contentType: SOURCE_SNAPSHOT_CONTENT_TYPE,
    fileCount,
  };
}
