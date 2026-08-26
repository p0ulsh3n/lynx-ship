import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { sha256, assert, type Artifact } from "@lynxship/contracts";

export class FileStorage {
  constructor(readonly root: string) {}

  async put(
    data: Buffer | string,
    options: { contentType?: string } = {},
  ): Promise<Artifact> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = sha256(buffer);
    await mkdir(this.root, { recursive: true });
    const file = join(this.root, hash);
    try {
      await readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        await writeFile(file, buffer.toString("latin1"), {
          flag: "wx",
          encoding: "latin1",
        });
      else throw error;
    }
    return {
      key: `sha256/${hash}`,
      hash,
      size: buffer.length,
      contentType: options.contentType ?? "application/octet-stream",
    };
  }

  get(hash: string) {
    return readFile(join(this.root, hash));
  }
}

export class ObjectStorage {
  constructor(readonly backend: FileStorage) {}

  put(data: Buffer | string, options?: { contentType?: string }) {
    return this.backend.put(data, options);
  }

  get(hash: string) {
    return this.backend.get(hash);
  }
}

export class S3ObjectStorage {
  readonly driver = "s3" as const;

  readonly client: S3Client;

  constructor(
    readonly endpoint: string,
    readonly accessKeyId: string,
    readonly secretAccessKey: string,
    readonly bucket = "lynxship",
  ) {
    this.client = new S3Client({
      endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async initialize(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async put(
    key: string,
    data: Buffer | string,
    contentType = "application/octet-stream",
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    assert(
      result.Body,
      "STORAGE_OBJECT_NOT_FOUND",
      "Storage object body is empty",
    );
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async head(key: string): Promise<{ size: number; contentType?: string }> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    assert(
      typeof result.ContentLength === "number",
      "STORAGE_OBJECT_INVALID",
      "Storage object metadata is incomplete",
    );
    return {
      size: result.ContentLength,
      contentType: result.ContentType,
    };
  }

  async probe(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

export function validatePresignedAccess(input: {
  provider?: string;
  endpoint: string;
  customDomain?: boolean;
}) {
  assert(input.endpoint, "STORAGE_ENDPOINT", "Storage endpoint is required");
  if (input.provider === "r2" && input.customDomain)
    return {
      allowed: false,
      reason:
        "R2 presigned URLs require the S3 API endpoint, not a custom domain",
    };
  return {
    allowed: true,
    mode: input.customDomain
      ? "immutable-public-or-authenticated-custom-domain"
      : "presigned-s3-endpoint",
  };
}

export class IdGenerator {
  static create(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString("hex")}`;
  }
}
