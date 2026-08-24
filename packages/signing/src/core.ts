import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import {
  assert,
  canonicalize,
  createId,
  sha256,
  type OtaManifest,
} from "@lynxship/contracts";

export interface SigningKey {
  keyId: string;
  publicKey: string;
  privateKey: string;
}

export function createSigningKey(): SigningKey {
  const pair = generateKeyPairSync("ed25519");
  return {
    keyId: `key_${createId("ed").slice(-12)}`,
    publicKey: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}

export interface ManifestAssetInput {
  path: string;
  data?: string;
  hash?: string;
  size?: number;
  url?: string;
}

export interface CreateManifestInput {
  projectId: string;
  channel: string;
  platform: OtaManifest["platform"];
  runtimeVersion: string;
  sequence: number;
  assets: ManifestAssetInput[];
  keyId: string;
}

export function createManifest(input: CreateManifestInput): OtaManifest {
  assert(
    input.assets.length > 0,
    "OTA_ASSETS_REQUIRED",
    "At least one OTA asset is required",
  );
  for (const asset of input.assets) {
    if (!asset.url) continue;
    let parsed: URL;
    try {
      parsed = new URL(asset.url);
    } catch {
      throw new Error(`Invalid OTA asset URL: ${asset.path}`);
    }
    assert(
      parsed.protocol === "https:" || parsed.protocol === "http:",
      "OTA_ASSET_URL_INVALID",
      "OTA asset URLs must use HTTP or HTTPS",
    );
  }
  return {
    protocolVersion: 1,
    projectId: input.projectId,
    channel: input.channel,
    platform: input.platform,
    runtimeVersion: input.runtimeVersion,
    sequence: input.sequence,
    keyId: input.keyId,
    assets: input.assets
      .map((asset) => ({
        path: asset.path,
        hash: asset.hash ?? sha256(asset.data ?? ""),
        size: asset.size ?? Buffer.byteLength(asset.data ?? ""),
        ...(asset.url ? { url: asset.url } : {}),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function signManifest(
  manifest: OtaManifest,
  privateKey: string,
): string {
  const payload = Buffer.from(canonicalize(manifest)) as unknown as Parameters<
    typeof sign
  >[1];
  return sign(null, payload, createPrivateKey(privateKey)).toString(
    "base64url",
  );
}

export function verifyManifest(
  manifest: OtaManifest,
  signature: string,
  publicKey: string,
): boolean {
  const payload = Buffer.from(canonicalize(manifest)) as unknown as Parameters<
    typeof verify
  >[1];
  const signatureBytes = Buffer.from(
    signature,
    "base64url",
  ) as unknown as Parameters<typeof verify>[3];
  return verify(null, payload, createPublicKey(publicKey), signatureBytes);
}

export interface PolicyInput {
  platform: OtaManifest["platform"];
  nativeExecutable?: boolean;
  policyApprovalId?: string | null;
}

export interface PolicyResult {
  verdict: "PASS" | "REVIEW" | "BLOCK";
  reason: string;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  if (input.nativeExecutable)
    return {
      verdict: "BLOCK",
      reason: "Native executable OTA is not supported",
    };
  if (input.platform === "ios" && !input.policyApprovalId)
    return {
      verdict: "REVIEW",
      reason: "iOS OTA must be reviewed against current App Store policy",
    };
  return {
    verdict: "PASS",
    reason: "Interpreted bundle only and policy profile permits this platform",
  };
}

export function hashManifest(manifest: OtaManifest): string {
  return sha256(canonicalize(manifest));
}

export function validateKey(key: SigningKey): void {
  assert(
    key.keyId && key.publicKey && key.privateKey,
    "SIGNING_KEY_INVALID",
    "A complete signing key is required",
  );
}
