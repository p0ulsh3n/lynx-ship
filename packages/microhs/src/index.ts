import { createHash, randomUUID, verify as verifyEd25519 } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const MICROHS_MANIFEST_VERSION = 1 as const;

export type MicroHsHostTriple =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win32-x64";

export interface MicroHsArtifact {
  url: string;
  sha256: string;
  signatureUrl?: string;
  signatureBase64?: string;
}

export interface MicroHsReleaseManifest {
  schemaVersion: typeof MICROHS_MANIFEST_VERSION;
  version: string;
  sourceCommit: string;
  artifacts: Partial<Record<MicroHsHostTriple, MicroHsArtifact>>;
}

export interface MicroHsAcquireOptions {
  version?: string;
  binaryPath?: string;
  manifestPath?: string;
  manifestUrl?: string;
  cacheDir?: string;
  publicKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  arch?: string;
}

export interface MicroHsToolchain {
  binaryPath: string;
  hostTriple: MicroHsHostTriple;
  version: string;
  source: "path" | "cache" | "download";
  sha256?: string;
}

export class MicroHsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MicroHsError";
    this.code = code;
  }
}

const supportedTriples = new Set<MicroHsHostTriple>([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);

function assert(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new MicroHsError(code, message);
}

export function microHsHostTriple(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): MicroHsHostTriple {
  const normalizedArch = arch === "ia32" ? "x86" : arch;
  const triple = `${platform}-${normalizedArch}`;
  assert(
    supportedTriples.has(triple as MicroHsHostTriple),
    "MICROHS_HOST_UNSUPPORTED",
    `MicroHs has no verified LynxShip binary for ${triple}. Supported hosts: ${[...supportedTriples].join(", ")}.`,
  );
  return triple as MicroHsHostTriple;
}

export function defaultMicroHsCacheDir(): string {
  return process.platform === "win32"
    ? join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
        "LynxShip",
        "microhs",
      )
    : join(
        process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
        "lynxship",
        "microhs",
      );
}

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
  assert(
    value && typeof value === "object",
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' is invalid.`,
  );
  const artifact = value as Record<string, unknown>;
  assert(
    validHttpsUrl(artifact.url),
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' must contain an HTTPS URL.`,
  );
  assert(
    validSha256(artifact.sha256),
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' must contain a hexadecimal SHA-256.`,
  );
  assert(
    artifact.signatureUrl === undefined || validHttpsUrl(artifact.signatureUrl),
    "MICROHS_MANIFEST_INVALID",
    `Artifact '${key}' has an invalid signatureUrl.`,
  );
  assert(
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
  assert(
    value && typeof value === "object",
    "MICROHS_MANIFEST_INVALID",
    "MicroHs manifest must be a JSON object.",
  );
  const manifest = value as Record<string, unknown>;
  assert(
    manifest.schemaVersion === MICROHS_MANIFEST_VERSION,
    "MICROHS_MANIFEST_VERSION",
    "Unsupported MicroHs manifest schema version.",
  );
  assert(
    typeof manifest.version === "string" && manifest.version.trim().length > 0,
    "MICROHS_MANIFEST_INVALID",
    "MicroHs manifest version is required.",
  );
  assert(
    typeof manifest.sourceCommit === "string" &&
      /^[a-f0-9]{7,64}$/i.test(manifest.sourceCommit),
    "MICROHS_MANIFEST_INVALID",
    "MicroHs sourceCommit must be a Git commit hash.",
  );
  assert(
    manifest.artifacts &&
      typeof manifest.artifacts === "object" &&
      !Array.isArray(manifest.artifacts),
    "MICROHS_MANIFEST_INVALID",
    "MicroHs artifacts are required.",
  );

  const artifacts: Partial<Record<MicroHsHostTriple, MicroHsArtifact>> = {};
  for (const [key, valueForKey] of Object.entries(
    manifest.artifacts as Record<string, unknown>,
  )) {
    assert(
      supportedTriples.has(key as MicroHsHostTriple),
      "MICROHS_MANIFEST_INVALID",
      `Unsupported MicroHs host '${key}'.`,
    );
    artifacts[key as MicroHsHostTriple] = validateArtifact(valueForKey, key);
  }
  assert(
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

async function readManifest(
  options: MicroHsAcquireOptions,
): Promise<MicroHsReleaseManifest> {
  const manifestPath =
    options.manifestPath ?? process.env.LYNXSHIP_MICROHS_MANIFEST;
  const manifestUrl =
    options.manifestUrl ?? process.env.LYNXSHIP_MICROHS_MANIFEST_URL;
  assert(
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

  assert(
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
    assert(
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

async function isExecutable(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

async function sha256File(file: string): Promise<string> {
  const data = await readFile(file);
  return createHash("sha256")
    .update(data as unknown as Uint8Array<ArrayBuffer>)
    .digest("hex");
}

async function fetchBytes(
  url: string,
  options: MicroHsAcquireOptions,
): Promise<Uint8Array> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 120_000,
  );
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    assert(
      response.ok,
      "MICROHS_DOWNLOAD_FAILED",
      `MicroHs download failed with HTTP ${response.status}.`,
    );
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof MicroHsError) throw error;
    throw new MicroHsError(
      "MICROHS_DOWNLOAD_FAILED",
      `Unable to download MicroHs: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function verifySignature(
  artifact: MicroHsArtifact,
  binary: Uint8Array,
  publicKey: string | undefined,
  options: MicroHsAcquireOptions,
): Promise<void> {
  if (!artifact.signatureUrl && !artifact.signatureBase64) return;
  assert(
    publicKey,
    "MICROHS_SIGNATURE_KEY_REQUIRED",
    "This MicroHs artifact is signed; configure the pinned Ed25519 public key before downloading it.",
  );
  const signature = artifact.signatureBase64
    ? Buffer.from(artifact.signatureBase64, "base64")
    : Buffer.from(await fetchBytes(artifact.signatureUrl!, options));
  assert(
    verifyEd25519(
      null,
      binary as unknown as Uint8Array<ArrayBuffer>,
      publicKey,
      signature as unknown as Uint8Array<ArrayBuffer>,
    ),
    "MICROHS_SIGNATURE_INVALID",
    "MicroHs artifact signature verification failed.",
  );
}

async function installDownloadedBinary(
  bytes: Uint8Array,
  expectedSha256: string,
  destination: string,
  artifact: MicroHsArtifact,
  publicKey: string | undefined,
  options: MicroHsAcquireOptions,
): Promise<string> {
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  assert(
    actualSha256 === expectedSha256,
    "MICROHS_HASH_MISMATCH",
    `MicroHs SHA-256 mismatch. Expected ${expectedSha256}, received ${actualSha256}.`,
  );
  await verifySignature(artifact, bytes, publicKey, options);
  // Use a unique temporary file next to the cache so rename is atomic on the
  // same volume and an interrupted download cannot become executable.
  const temporary = `${destination}.download-${randomUUID()}`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o755 });
    if (process.platform !== "win32") await chmod(temporary, 0o755);
    try {
      await rename(temporary, destination);
    } catch (error) {
      // Another LynxShip process may have populated the same cache entry
      // between the cache check and this rename. Reuse it only after hashing
      // it against the manifest; never accept a race-created unverified file.
      if (
        (error as NodeJS.ErrnoException).code === "EEXIST" ||
        (error as NodeJS.ErrnoException).code === "EPERM"
      ) {
        assert(
          (await isExecutable(destination)) &&
            (await sha256File(destination)) === expectedSha256,
          "MICROHS_CACHE_RACE",
          "A concurrent MicroHs cache write produced an unverified binary.",
        );
        return expectedSha256;
      }
      throw error;
    }
    return actualSha256;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function acquireMicroHs(
  options: MicroHsAcquireOptions = {},
): Promise<MicroHsToolchain> {
  const hostTriple = microHsHostTriple(options.platform, options.arch);
  const explicitPath =
    options.binaryPath ?? process.env.LYNXSHIP_MICROHS_BINARY;
  if (explicitPath) {
    const binaryPath = resolve(explicitPath);
    assert(
      await isExecutable(binaryPath),
      "MICROHS_BINARY_MISSING",
      `MicroHs binary not found at '${binaryPath}'.`,
    );
    return {
      binaryPath,
      hostTriple,
      version: options.version ?? "external",
      source: "path",
    };
  }

  const manifest = await readManifest(options);
  const artifact = manifest.artifacts[hostTriple];
  assert(
    artifact,
    "MICROHS_ARTIFACT_UNAVAILABLE",
    `MicroHs release ${manifest.version} has no artifact for ${hostTriple}.`,
  );
  if (options.version)
    assert(
      options.version === manifest.version,
      "MICROHS_VERSION_MISMATCH",
      `Requested MicroHs ${options.version}, but the manifest contains ${manifest.version}.`,
    );

  const cacheDir = resolve(
    options.cacheDir ??
      process.env.LYNXSHIP_MICROHS_CACHE ??
      defaultMicroHsCacheDir(),
  );
  const destination = join(
    cacheDir,
    manifest.version,
    hostTriple,
    process.platform === "win32" ? "mhs.exe" : "mhs",
  );
  if (
    (await isExecutable(destination)) &&
    (await sha256File(destination)) === artifact.sha256
  ) {
    return {
      binaryPath: destination,
      hostTriple,
      version: manifest.version,
      source: "cache",
      sha256: artifact.sha256,
    };
  }

  const bytes = await fetchBytes(artifact.url, options);
  const sha256 = await installDownloadedBinary(
    bytes,
    artifact.sha256,
    destination,
    artifact,
    options.publicKey ?? process.env.LYNXSHIP_MICROHS_PUBLIC_KEY,
    options,
  );
  return {
    binaryPath: destination,
    hostTriple,
    version: manifest.version,
    source: "download",
    sha256,
  };
}

export function microHsManifestFromEnvironment(): Pick<
  MicroHsAcquireOptions,
  "manifestPath" | "manifestUrl" | "binaryPath" | "version"
> {
  return {
    ...(process.env.LYNXSHIP_MICROHS_MANIFEST
      ? { manifestPath: process.env.LYNXSHIP_MICROHS_MANIFEST }
      : {}),
    ...(process.env.LYNXSHIP_MICROHS_MANIFEST_URL
      ? { manifestUrl: process.env.LYNXSHIP_MICROHS_MANIFEST_URL }
      : {}),
    ...(process.env.LYNXSHIP_MICROHS_BINARY
      ? { binaryPath: process.env.LYNXSHIP_MICROHS_BINARY }
      : {}),
    ...(process.env.LYNXSHIP_MICROHS_VERSION
      ? { version: process.env.LYNXSHIP_MICROHS_VERSION }
      : {}),
  };
}
