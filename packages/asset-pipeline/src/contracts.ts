export const DEFAULT_IGNORED_ASSET_NAMES = [
  ".git",
  ".lynxship",
  "node_modules",
  ".env",
  ".env.*",
] as const;

export type AssetKind =
  | "image"
  | "font"
  | "audio"
  | "video"
  | "stylesheet"
  | "bundle"
  | "data"
  | "other";

export interface AssetRecord {
  path: string;
  size: number;
  sha256: string;
  kind: AssetKind;
  contentType: string;
}

export interface AssetManifest {
  version: 1;
  root: string;
  files: readonly AssetRecord[];
  sha256: string;
}

export interface AssetDiscoveryOptions {
  root: string;
  include?: readonly string[];
  ignore?: readonly string[];
}

export interface AssetSyncPlanEntry extends AssetRecord {
  source: string;
  target: string;
}

export interface AssetSyncPlan {
  sourceRoot: string;
  targetRoot: string;
  files: readonly AssetSyncPlanEntry[];
}

export class AssetPipelineError extends Error {
  readonly code:
    | "ASSET_ROOT_MISSING"
    | "ASSET_PATH_ESCAPE"
    | "ASSET_FILE_READ"
    | "ASSET_MANIFEST_INVALID"
    | "ASSET_HASH_MISMATCH"
    | "ASSET_TARGET_ESCAPE";

  constructor(code: AssetPipelineError["code"], message: string) {
    super(message);
    this.name = "AssetPipelineError";
    this.code = code;
  }
}
