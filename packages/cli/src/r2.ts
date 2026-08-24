import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assert, sha256 } from "@lynxship/contracts";
import { loadCredentials, type StoredCredentials } from "./secure-store.js";
import { globalLynxShipDirectory } from "./paths.js";

export interface R2Config {
  accountId: string;
  bucket: string;
  endpoint: string;
  expiresIn: number;
}

export interface R2Artifact {
  key: string;
  hash: string;
  size: number;
  contentType: string;
  url: string;
  expiresAt: string;
}

export interface R2UploadOptions {
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}

const configFileName = "r2.json";

function configFile(root: string): string {
  return join(root, ".lynxship", configFileName);
}

function globalConfigFile(): string {
  return join(globalLynxShipDirectory(), configFileName);
}

function defaultEndpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function validateConfig(config: R2Config): R2Config {
  assert(
    /^[a-f0-9]{32}$/i.test(config.accountId),
    "CLI_R2_ACCOUNT_ID",
    "Cloudflare account ID must be a 32-character hexadecimal value",
  );
  assert(
    /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket),
    "CLI_R2_BUCKET",
    "R2 bucket name is invalid",
  );
  assert(
    config.endpoint.startsWith("https://"),
    "CLI_R2_ENDPOINT",
    "R2 S3 endpoint must use HTTPS",
  );
  assert(
    config.expiresIn >= 1 && config.expiresIn <= 604800,
    "CLI_R2_EXPIRY",
    "R2 download URL expiry must be between 1 second and 7 days",
  );
  return config;
}

export async function loadR2(root: string): Promise<{
  config: R2Config;
  credentials: NonNullable<StoredCredentials["r2"]>;
}> {
  let config: R2Config;
  try {
    let file = configFile(root);
    if (
      !(await access(file)
        .then(() => true)
        .catch(() => false))
    )
      file = globalConfigFile();
    config = JSON.parse(await readFile(file, "utf8")) as R2Config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const bucket = process.env.R2_BUCKET;
      assert(
        accountId && bucket,
        "CLI_R2_REQUIRED",
        "R2 is not configured. Run `lynxship storage configure` first.",
      );
      config = {
        accountId,
        bucket,
        endpoint: process.env.R2_ENDPOINT ?? defaultEndpoint(accountId),
        expiresIn: Number(process.env.R2_DOWNLOAD_EXPIRES_IN ?? "86400"),
      };
    } else throw error;
  }
  const credentials =
    (await loadCredentials(root)).r2 ??
    (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        }
      : undefined);
  assert(
    credentials,
    "CLI_R2_CREDENTIALS",
    "R2 credentials are missing. Run `lynxship storage configure` again.",
  );
  return { config: validateConfig(config), credentials };
}

export function createR2Client(
  config: R2Config,
  credentials: NonNullable<StoredCredentials["r2"]>,
): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials,
  });
}

export async function verifyR2(
  config: R2Config,
  credentials: NonNullable<StoredCredentials["r2"]>,
): Promise<void> {
  const client = createR2Client(config, credentials);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } finally {
    client.destroy();
  }
}

export async function uploadR2Artifact(
  root: string,
  projectId: string,
  buildId: string,
  file: string,
  contentType: string,
  objectName?: string,
  options: R2UploadOptions = {},
): Promise<R2Artifact> {
  const { config, credentials } = await loadR2(root);
  const content = await readFile(file);
  const hash = sha256(content);
  const filename = file.split(/[\\/]/).at(-1) ?? "artifact";
  const key = `artifacts/${projectId}/${buildId}/${objectName ?? filename}`;
  const client = createR2Client(config, credentials);
  options.onProgress?.(0, content.length);
  try {
    const upload = new Upload({
      client,
      queueSize: 1,
      partSize: 8 * 1024 * 1024,
      params: {
        Bucket: config.bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${filename}"`,
        ContentLength: content.length,
        Metadata: { sha256: hash, buildId },
      },
    });
    upload.on("httpUploadProgress", (progress) => {
      options.onProgress?.(
        progress.loaded ?? 0,
        progress.total ?? content.length,
      );
    });
    await upload.done();
    const expiresAt = new Date(Date.now() + config.expiresIn * 1000);
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
      { expiresIn: config.expiresIn },
    );
    return {
      key,
      hash,
      size: content.length,
      contentType,
      url,
      expiresAt: expiresAt.toISOString(),
    };
  } finally {
    client.destroy();
  }
}

export async function writeR2Config(
  root: string,
  config: R2Config,
  options: { global?: boolean } = {},
): Promise<void> {
  validateConfig(config);
  const directory = options.global
    ? globalLynxShipDirectory()
    : join(root, ".lynxship");
  await mkdir(directory, { recursive: true });
  const file = options.global ? globalConfigFile() : configFile(root);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(file, 0o600).catch(() => undefined);
  await access(file);
}

export { defaultEndpoint };
