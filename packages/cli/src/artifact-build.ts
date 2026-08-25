import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { transitionBuild } from "@lynxship/build-orchestrator";
import {
  assert,
  sha256,
  type BuildJob,
  type Platform,
} from "@lynxship/contracts";
import {
  nativeArtifactName,
  type NativeArtifactExtension,
} from "./artifact-name.js";
import { loadR2, uploadR2Artifact } from "./r2.js";

export interface ArtifactBuildOptions {
  root: string;
  job: BuildJob;
  platform: Platform;
  artifactPath: string;
  extension: NativeArtifactExtension;
  contentType: string;
  uploadArtifacts: boolean;
  verificationMessage: string;
  quiet?: boolean;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
}

export async function publishBuiltArtifact(
  options: ArtifactBuildOptions,
): Promise<BuildJob> {
  const {
    root,
    job,
    platform,
    artifactPath,
    extension,
    contentType,
    uploadArtifacts,
    onEvent,
    onProgress,
  } = options;
  const artifactName = nativeArtifactName(extension);
  const artifactDirectory = join(root, ".lynxship", "artifacts");
  const artifactPathCopy = join(artifactDirectory, artifactName);
  await mkdir(artifactDirectory, { recursive: true });
  await copyFile(artifactPath, artifactPathCopy);
  const content = await readFile(artifactPathCopy);
  const hash = sha256(content);
  job.attempts += 1;
  transitionBuild(job, "signing", options.verificationMessage);
  transitionBuild(job, "uploading_artifacts", `${platform} artifact collected`);

  const step = (message: string, value?: number): void => {
    onEvent?.(message);
    onProgress?.(value, message);
  };
  if (!uploadArtifacts) {
    step("Artifact collected locally; R2 upload skipped", 100);
    job.artifact = {
      name: artifactName,
      hash,
      path: artifactPathCopy,
      size: content.length,
      contentType,
    };
  } else {
    await loadR2(root);
    step("Uploading artifact to Cloudflare R2…", 80);
    const uploaded = await uploadR2Artifact(
      root,
      job.projectId,
      job.id,
      artifactPathCopy,
      contentType,
      undefined,
      {
        onProgress: (uploadedBytes, totalBytes) => {
          const transfer = totalBytes === 0 ? 1 : uploadedBytes / totalBytes;
          onProgress?.(
            80 + transfer * 19,
            `Uploading artifact to Cloudflare R2… ${Math.round(transfer * 10000) / 100}%`,
          );
        },
      },
    );
    assert(
      uploaded.hash === hash,
      "BUILD_ARTIFACT_HASH",
      "R2 artifact hash mismatch",
    );
    job.artifact = {
      name: artifactName,
      hash,
      path: artifactPathCopy,
      key: uploaded.key,
      size: uploaded.size,
      contentType: uploaded.contentType,
      url: uploaded.url,
      expiresAt: uploaded.expiresAt,
    };
  }
  step(`Artifact ready: ${artifactName}`, 100);
  return transitionBuild(job, "success", `real ${platform} artifact created`);
}
