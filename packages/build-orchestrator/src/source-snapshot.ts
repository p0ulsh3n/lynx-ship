import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  assert,
  canonicalize,
  hashJson,
  sha256,
  type BuildSourceReference,
} from "@lynxship/contracts";

export const SOURCE_SNAPSHOT_CONTENT_TYPE =
  "application/vnd.lynxship.source-snapshot+json";

export interface SourceSnapshotFile {
  path: string;
  hash: string;
  size: number;
  mode: number;
  dataBase64: string;
}

export interface SourceSnapshot {
  schemaVersion: 1;
  manifestHash: string;
  files: SourceSnapshotFile[];
}

export interface SourceSnapshotLimits {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface CreatedSourceSnapshot {
  snapshot: SourceSnapshot;
  bytes: Buffer;
  reference: BuildSourceReference;
}

const defaultLimits: Required<SourceSnapshotLimits> = {
  maxFiles: 20_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

const sensitiveFile =
  /(^|\/)(\.env(?:\..*)?|.*\.(?:pem|p12|pfx|key|keystore|jks|mobileprovision|provisionprofile|p8)|google-services\.json|GoogleService-Info\.plist)$/i;

export async function createSourceSnapshot(
  root: string,
  options: {
    ignored?: ReadonlySet<string>;
    limits?: SourceSnapshotLimits;
  } = {},
): Promise<CreatedSourceSnapshot> {
  const limits = normalizedLimits(options.limits);
  const files: SourceSnapshotFile[] = [];
  const ignored =
    options.ignored ??
    new Set([".git", "node_modules", "dist", "build", ".lynxship"]);
  const projectRoot = resolve(root);
  let totalBytes = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue;
      assert(
        !entry.isSymbolicLink(),
        "SOURCE_SYMLINK_UNSUPPORTED",
        `Source snapshot refuses symbolic link: ${entry.name}`,
      );
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      assert(
        entry.isFile(),
        "SOURCE_FILE_UNSUPPORTED",
        `Source snapshot supports regular files only: ${entry.name}`,
      );
      const path = relative(projectRoot, absolutePath).replaceAll("\\", "/");
      assertSafeSourcePath(path);
      assert(
        !sensitiveFile.test(path),
        "SOURCE_SECRET_FILE",
        `Refusing to upload a credential-like source file: ${path}`,
      );
      const data = await readFile(absolutePath);
      const metadata = await stat(absolutePath);
      assertSourceSize(data.length, limits, path, totalBytes);
      totalBytes += data.length;
      files.push({
        path,
        hash: sha256(data),
        size: data.length,
        mode: metadata.mode & 0o777,
        dataBase64: data.toString("base64"),
      });
      assert(
        files.length <= limits.maxFiles,
        "SOURCE_FILE_LIMIT",
        `Source snapshot contains more than ${limits.maxFiles} files`,
      );
    }
  }

  await visit(projectRoot);
  const snapshot = validateSourceSnapshot(
    {
      schemaVersion: 1,
      manifestHash: hashJson(
        files.map(({ path, hash, size, mode }) => ({ path, hash, size, mode })),
      ),
      files,
    },
    limits,
  );
  const bytes = encodeSourceSnapshot(snapshot);
  const hash = sha256(bytes);
  return {
    snapshot,
    bytes,
    reference: {
      key: `sources/${hash}`,
      hash,
      size: bytes.length,
      contentType: SOURCE_SNAPSHOT_CONTENT_TYPE,
      fileCount: snapshot.files.length,
    },
  };
}

export function encodeSourceSnapshot(snapshot: SourceSnapshot): Buffer {
  const valid = validateSourceSnapshot(snapshot);
  return Buffer.from(canonicalize(valid), "utf8");
}

export function decodeSourceSnapshot(
  bytes: Buffer,
  limits?: SourceSnapshotLimits,
): SourceSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    assert(
      false,
      "SOURCE_SNAPSHOT_INVALID",
      "Source snapshot is not valid JSON",
    );
  }
  return validateSourceSnapshot(value, limits);
}

export function verifySourceObject(
  bytes: Buffer,
  reference: BuildSourceReference,
  limits?: SourceSnapshotLimits,
): SourceSnapshot {
  validateSourceReference(reference);
  assert(
    bytes.length === reference.size && sha256(bytes) === reference.hash,
    "SOURCE_INTEGRITY",
    "Downloaded source does not match its content-addressed reference",
  );
  const snapshot = decodeSourceSnapshot(bytes, limits);
  assert(
    snapshot.files.length === reference.fileCount,
    "SOURCE_REFERENCE_INVALID",
    "Source reference file count does not match its snapshot",
  );
  return snapshot;
}

export function validateSourceReference(
  value: unknown,
): asserts value is BuildSourceReference {
  assert(
    Boolean(value) && typeof value === "object",
    "SOURCE_REFERENCE_INVALID",
    "Source reference must be an object",
  );
  const reference = value as Record<string, unknown>;
  assert(
    typeof reference.key === "string" &&
      reference.key.length > 0 &&
      reference.key.length <= 1_024 &&
      !reference.key.startsWith("/") &&
      !reference.key.includes("\\") &&
      !reference.key.includes("\0") &&
      !/(^|\/)\.\.(\/|$)/.test(reference.key),
    "SOURCE_REFERENCE_INVALID",
    "Source reference key contains an unsupported path",
  );
  assert(
    /^[a-f0-9]{64}$/.test(String(reference.hash)),
    "SOURCE_REFERENCE_INVALID",
    "Source reference hash must be a lowercase SHA-256 digest",
  );
  assert(
    Number.isSafeInteger(reference.size) && Number(reference.size) >= 0,
    "SOURCE_REFERENCE_INVALID",
    "Source reference size must be a non-negative safe integer",
  );
  assert(
    Number.isSafeInteger(reference.fileCount) &&
      Number(reference.fileCount) >= 0,
    "SOURCE_REFERENCE_INVALID",
    "Source reference file count must be a non-negative safe integer",
  );
  assert(
    reference.contentType === SOURCE_SNAPSHOT_CONTENT_TYPE,
    "SOURCE_REFERENCE_INVALID",
    "Source reference content type is unsupported",
  );
}

export async function materializeSourceSnapshot(
  bytes: Buffer,
  reference: BuildSourceReference,
  root: string,
  limits?: SourceSnapshotLimits,
): Promise<{ root: string; snapshot: SourceSnapshot }> {
  const snapshot = verifySourceObject(bytes, reference, limits);
  const targetRoot = resolve(root);
  await mkdir(targetRoot, { recursive: true });
  assert(
    (await readdir(targetRoot)).length === 0,
    "SOURCE_TARGET_NOT_EMPTY",
    "Source materialization requires an empty workspace directory",
  );
  for (const file of snapshot.files) {
    const target = resolve(targetRoot, file.path);
    assertWithinRoot(targetRoot, target);
    await mkdir(dirname(target), { recursive: true });
    const data = Buffer.from(file.dataBase64, "base64");
    await writeFile(target, data as unknown as Uint8Array<ArrayBuffer>, {
      flag: "wx",
      mode: file.mode,
    });
    if (file.mode & 0o111) await chmod(target, file.mode);
  }
  return { root: targetRoot, snapshot };
}

function validateSourceSnapshot(
  value: unknown,
  limitsInput: SourceSnapshotLimits = {},
): SourceSnapshot {
  const limits = normalizedLimits(limitsInput);
  assert(
    Boolean(value) && typeof value === "object",
    "SOURCE_SNAPSHOT_INVALID",
    "Source snapshot must be an object",
  );
  const candidate = value as Record<string, unknown>;
  assert(
    candidate.schemaVersion === 1 &&
      typeof candidate.manifestHash === "string" &&
      Array.isArray(candidate.files),
    "SOURCE_SNAPSHOT_INVALID",
    "Unsupported source snapshot schema",
  );
  const files: SourceSnapshotFile[] = [];
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const item of candidate.files) {
    assert(
      Boolean(item) && typeof item === "object",
      "SOURCE_SNAPSHOT_INVALID",
      "Source snapshot file entry must be an object",
    );
    const file = item as Record<string, unknown>;
    assert(
      typeof file.path === "string" &&
        typeof file.hash === "string" &&
        typeof file.dataBase64 === "string" &&
        Number.isSafeInteger(file.size) &&
        Number.isSafeInteger(file.mode),
      "SOURCE_SNAPSHOT_INVALID",
      "Source snapshot file entry is malformed",
    );
    const path = file.path as string;
    const hash = file.hash as string;
    const dataBase64 = file.dataBase64 as string;
    const size = typeof file.size === "number" ? file.size : Number.NaN;
    const mode = typeof file.mode === "number" ? file.mode : Number.NaN;
    assertSafeSourcePath(path);
    assert(
      !sensitiveFile.test(path),
      "SOURCE_SECRET_FILE",
      `Refusing a credential-like source file: ${path}`,
    );
    assert(
      !paths.has(path),
      "SOURCE_DUPLICATE_PATH",
      `Duplicate source path: ${path}`,
    );
    paths.add(path);
    assert(
      /^[a-f0-9]{64}$/.test(hash),
      "SOURCE_SNAPSHOT_INVALID",
      `Invalid SHA-256 for source file: ${path}`,
    );
    assert(
      size >= 0 && size <= limits.maxFileBytes && mode >= 0 && mode <= 0o777,
      "SOURCE_FILE_LIMIT",
      `Source file exceeds limits or has an invalid mode: ${path}`,
    );
    const data = decodeBase64(dataBase64, path);
    assert(
      data.length === size && sha256(data) === hash,
      "SOURCE_INTEGRITY",
      `Source file content does not match its declared hash: ${path}`,
    );
    totalBytes += data.length;
    assert(
      totalBytes <= limits.maxTotalBytes,
      "SOURCE_TOTAL_LIMIT",
      `Source snapshot exceeds ${limits.maxTotalBytes} bytes`,
    );
    files.push({
      path,
      hash,
      size,
      mode,
      dataBase64,
    });
  }
  assert(
    files.length <= limits.maxFiles,
    "SOURCE_FILE_LIMIT",
    `Source snapshot contains more than ${limits.maxFiles} files`,
  );
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifestHash = hashJson(
    files.map(({ path, hash, size, mode }) => ({ path, hash, size, mode })),
  );
  assert(
    candidate.manifestHash === manifestHash,
    "SOURCE_MANIFEST_INVALID",
    "Source snapshot manifest hash does not match its files",
  );
  return { schemaVersion: 1, manifestHash, files };
}

function normalizedLimits(
  input: SourceSnapshotLimits = {},
): Required<SourceSnapshotLimits> {
  const limits = { ...defaultLimits, ...input };
  assert(
    Number.isSafeInteger(limits.maxFiles) &&
      limits.maxFiles > 0 &&
      Number.isSafeInteger(limits.maxFileBytes) &&
      limits.maxFileBytes > 0 &&
      Number.isSafeInteger(limits.maxTotalBytes) &&
      limits.maxTotalBytes > 0,
    "SOURCE_LIMIT_CONFIG",
    "Source snapshot limits must be positive safe integers",
  );
  return limits;
}

function assertSourceSize(
  size: number,
  limits: Required<SourceSnapshotLimits>,
  path: string,
  totalBytes: number,
): void {
  assert(
    size <= limits.maxFileBytes,
    "SOURCE_FILE_LIMIT",
    `Source file exceeds ${limits.maxFileBytes} bytes: ${path}`,
  );
  assert(
    totalBytes + size <= limits.maxTotalBytes,
    "SOURCE_TOTAL_LIMIT",
    `Source snapshot exceeds ${limits.maxTotalBytes} bytes`,
  );
}

function assertSafeSourcePath(path: string): void {
  const parts = path.split("/");
  assert(
    path.length > 0 &&
      path.length <= 1_024 &&
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      !path.includes("//") &&
      parts.every((part) => part.length > 0 && part !== "." && part !== ".."),
    "SOURCE_PATH_INVALID",
    `Source path is not a safe relative path: ${path}`,
  );
}

function assertWithinRoot(root: string, target: string): void {
  const rel = relative(root, target);
  assert(
    rel.length > 0 &&
      rel !== ".." &&
      !rel.startsWith(`..${requireSeparator()}`),
    "SOURCE_PATH_INVALID",
    "Source materialization escaped its workspace root",
  );
}

function requireSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function decodeBase64(value: string, path: string): Buffer {
  const data = Buffer.from(value, "base64");
  assert(
    data.toString("base64") === value,
    "SOURCE_BASE64_INVALID",
    `Source file is not canonical base64: ${path}`,
  );
  return data;
}
