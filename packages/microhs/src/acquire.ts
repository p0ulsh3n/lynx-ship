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
import { dirname, join, resolve } from "node:path";
import {
  MicroHsError,
  assertMicroHs,
  defaultMicroHsCacheDir,
  microHsHostTriple,
  type MicroHsAcquireOptions,
  type MicroHsArtifact,
  type MicroHsToolchain,
} from "./core.js";
import { readMicroHsManifest } from "./manifest.js";

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
    assertMicroHs(
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
  assertMicroHs(
    publicKey,
    "MICROHS_SIGNATURE_KEY_REQUIRED",
    "This MicroHs artifact is signed; configure the pinned Ed25519 public key before downloading it.",
  );
  const signature = artifact.signatureBase64
    ? Buffer.from(artifact.signatureBase64, "base64")
    : Buffer.from(await fetchBytes(artifact.signatureUrl!, options));
  assertMicroHs(
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
  assertMicroHs(
    actualSha256 === expectedSha256,
    "MICROHS_HASH_MISMATCH",
    `MicroHs SHA-256 mismatch. Expected ${expectedSha256}, received ${actualSha256}.`,
  );
  await verifySignature(artifact, bytes, publicKey, options);
  const temporary = `${destination}.download-${randomUUID()}`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o755 });
    if (process.platform !== "win32") await chmod(temporary, 0o755);
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "EEXIST" ||
        (error as NodeJS.ErrnoException).code === "EPERM"
      ) {
        assertMicroHs(
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
    assertMicroHs(
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

  const manifest = await readMicroHsManifest(options);
  const artifact = manifest.artifacts[hostTriple];
  assertMicroHs(
    artifact,
    "MICROHS_ARTIFACT_UNAVAILABLE",
    `MicroHs release ${manifest.version} has no artifact for ${hostTriple}.`,
  );
  if (options.version)
    assertMicroHs(
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
