import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MICROHS_MANIFEST_VERSION,
  MicroHsError,
  assertMicroHs,
  supportedTriples,
  type MicroHsAcquireOptions,
  type MicroHsArtifact,
  type MicroHsHostTriple,
  type MicroHsReleaseManifest,
} from "./core.js";

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateArtifact(value: unknown, key: string): MicroHsArtifact {
  assertMicroHs(
    value && typeof value === "object",
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' is invalid.`,
  );
  const artifact = value as Record<string, unknown>;
  assertMicroHs(
    validHttpsUrl(artifact.url),
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' must contain an HTTPS URL.`,
  );
  assertMicroHs(
    validSha256(artifact.sha256),
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' must contain a hexadecimal SHA-256.`,
  );
  assertMicroHs(
    artifact.signatureUrl === undefined || validHttpsUrl(artifact.signatureUrl),
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' has an invalid signatureUrl.`,
  );
  assertMicroHs(
    artifact.signatureBase64 === undefined ||
      typeof artifact.signatureBase64 === "string",
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' has an invalid signatureBase64.`,
  );
  return {
    url: artifact.url,
    sha256: artifact.sha256.toLowerCase(),
    ...(artifact.signatureUrl ? { signatureUrl: artifact.signatureUrl } : {}),
    ...(artifact.signatureBase64
      ? { signatureBase64: artifact.signatureBase64 }
      : {}),
  };
}

export function validateMicroHsManifest(
  value: unknown,
): MicroHsReleaseManifest {
  assertMicroHs(
    value && typeof value === "object",
    "MICROHS_MANIFEST_INVALID",
    "MicroHs manifest must be a JSON object.",
  );
  const manifest = value as Record<string, unknown>;
  assertMicroHs(
    manifest.schemaVersion === MICROHS_MANIFEST_VERSION,
    "MICROHS_MANIFEST_VERSION",
    "Unsupported MicroHs manifest schema version.",
  );
  assertMicroHs(
    typeof manifest.version === "string" && manifest.version.trim().length > 0,
    "MICROHS_MANIFEST_INVALID",
    "MicroHs manifest version is required.",
  );
  assertMicroHs(
    typeof manifest.sourceCommit === "string" &&
      /^[a-f0-9]{7,64}$/i.test(manifest.sourceCommit),
    "MICROHS_MANIFEST_INVALID",
    "MicroHs sourceCommit must be a Git commit hash.",
  );
  assertMicroHs(
    manifest.artifacts &&
      typeof manifest.artifacts === "object" &&
      !Array.isArray(manifest.artifacts),
    "MICROHS_MANIFEST_INVALID",
    "MicroHs artifacts are required.",
  );

  const artifacts: Partial<Record<MicroHsHostTriple, MicroHsArtifact>> = {};
  for (const [key, artifact] of Object.entries(
    manifest.artifacts as Record<string, unknown>,
  )) {
    assertMicroHs(
      supportedTriples.has(key as MicroHsHostTriple),
      "MICROHS_MANIFEST_INVALID",
      `Unsupported MicroHs host '${key}'.`,
    );
    artifacts[key as MicroHsHostTriple] = validateArtifact(artifact, key);
  }
  assertMicroHs(
    Object.keys(artifacts).length > 0,
    "MICROHS_MANIFEST_INVALID",
    "MicroHs manifest contains no artifacts.",
  );
  return {
    schemaVersion: MICROHS_MANIFEST_VERSION,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    artifacts,
  };
}

export async function readMicroHsManifest(
  options: MicroHsAcquireOptions,
): Promise<MicroHsReleaseManifest> {
  const manifestPath =
    options.manifestPath ?? process.env.LYNXSHIP_MICROHS_MANIFEST;
  const manifestUrl =
    options.manifestUrl ?? process.env.LYNXSHIP_MICROHS_MANIFEST_URL;
  assertMicroHs(
    manifestPath || manifestUrl,
    "MICROHS_MANIFEST_REQUIRED",
    "MicroHs needs a pinned manifest. Set build.<profile>.miso.microhs.manifest or LYNXSHIP_MICROHS_MANIFEST_URL.",
  );

  if (manifestPath) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
    } catch (error) {
      throw new MicroHsError(
        "MICROHS_MANIFEST_READ_FAILED",
        `Unable to read MicroHs manifest '${manifestPath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return validateMicroHsManifest(parsed);
  }

  assertMicroHs(
    validHttpsUrl(manifestUrl),
    "MICROHS_MANIFEST_INVALID",
    "MicroHs manifest URL must use HTTPS.",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000,
  );
  try {
    const response = await fetchImpl(manifestUrl, {
      signal: controller.signal,
    });
    assertMicroHs(
      response.ok,
      "MICROHS_MANIFEST_FETCH_FAILED",
      `MicroHs manifest request failed with HTTP ${response.status}.`,
    );
    return validateMicroHsManifest(await response.json());
  } catch (error) {
    if (error instanceof MicroHsError) throw error;
    throw new MicroHsError(
      "MICROHS_MANIFEST_FETCH_FAILED",
      `Unable to fetch MicroHs manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
