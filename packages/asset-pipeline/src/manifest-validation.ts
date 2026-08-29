import { manifestHash } from "./discovery.js";
import {
  AssetPipelineError,
  type AssetKind,
  type AssetManifest,
  type AssetRecord,
} from "./contracts.js";

const assetKinds: readonly AssetKind[] = [
  "image",
  "font",
  "audio",
  "video",
  "stylesheet",
  "bundle",
  "data",
  "other",
];

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:\//.test(value)) return false;
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function isRecord(value: unknown): value is AssetRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const asset = value as Partial<AssetRecord>;
  return (
    isSafeRelativePath(asset.path) &&
    typeof asset.size === "number" &&
    Number.isSafeInteger(asset.size) &&
    asset.size >= 0 &&
    isSha256(asset.sha256) &&
    typeof asset.kind === "string" &&
    assetKinds.includes(asset.kind) &&
    typeof asset.contentType === "string" &&
    asset.contentType.length > 0 &&
    !/[\u0000-\u001f]/.test(asset.contentType)
  );
}

export interface AssetManifestValidationOptions {
  verifyHash?: boolean;
}

export function validateAssetManifest(
  manifest: AssetManifest,
  options: AssetManifestValidationOptions = {},
): void {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.version !== 1 ||
    typeof manifest.root !== "string" ||
    manifest.root.length === 0 ||
    !Array.isArray(manifest.files) ||
    !isSha256(manifest.sha256)
  ) {
    throw new AssetPipelineError(
      "ASSET_MANIFEST_INVALID",
      "Asset manifest has an invalid envelope",
    );
  }

  const paths = new Set<string>();
  for (const asset of manifest.files) {
    const path =
      asset && typeof asset === "object"
        ? (asset as Partial<AssetRecord>).path
        : undefined;
    if (!isSafeRelativePath(path))
      throw new AssetPipelineError(
        "ASSET_PATH_ESCAPE",
        `Asset manifest contains an unsafe relative path: ${String(path)}`,
      );
    if (!isRecord(asset))
      throw new AssetPipelineError(
        "ASSET_MANIFEST_INVALID",
        "Asset manifest contains an invalid asset record",
      );
    if (paths.has(asset.path))
      throw new AssetPipelineError(
        "ASSET_MANIFEST_INVALID",
        `Asset manifest contains a duplicate path: ${asset.path}`,
      );
    paths.add(asset.path);
  }
  if (
    options.verifyHash !== false &&
    manifestHash(manifest.files) !== manifest.sha256
  )
    throw new AssetPipelineError(
      "ASSET_MANIFEST_INVALID",
      "Asset manifest hash does not match its asset records",
    );
}
