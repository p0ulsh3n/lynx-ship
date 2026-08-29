import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";
import { assert } from "@lynxship/contracts";
import { IdGenerator } from "@lynxship/storage";

export function redact(value: unknown, secrets: string[] = []): string {
  let output =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");
  for (const secret of secrets) {
    if (secret) output = output.replaceAll(secret, "[REDACTED]");
  }
  return output;
}

export function pruneExpired<T>(
  records: T[],
  options: {
    now?: number;
    getExpiresAt: (record: T) => string | null | undefined;
  },
): T[] {
  const now = options.now ?? Date.now();
  return records.filter((record) => {
    const expiresAt = options.getExpiresAt(record);
    return !expiresAt || new Date(expiresAt).getTime() > now;
  });
}

export interface SecretRecord {
  id: string;
  organizationId: string;
  projectId?: string;
  name: string;
  type: string;
  iv: string;
  tag: string;
  ciphertext: string;
  createdAt: string;
  rotatedAt: string | null;
}

export class SecretVault {
  private readonly recordStore = new Map<string, SecretRecord>();

  private readonly masterKey: Buffer;

  constructor(masterKey: Buffer | string = randomBytes(32)) {
    if (typeof masterKey === "string") {
      this.masterKey = createHash("sha256").update(masterKey).digest();
    } else {
      assert(
        masterKey.length === 32,
        "SECRET_MASTER_KEY",
        "Secret vault master key must be exactly 32 bytes",
      );
      this.masterKey = Buffer.from(
        masterKey as unknown as Uint8Array<ArrayBuffer>,
      );
    }
  }

  restore(records: readonly SecretRecord[]): void {
    this.recordStore.clear();
    for (const record of records)
      this.recordStore.set(record.id, structuredClone(record));
  }

  snapshot(): SecretRecord[] {
    return [...this.recordStore.values()].map((record) =>
      structuredClone(record),
    );
  }

  put(input: {
    organizationId: string;
    projectId?: string;
    name: string;
    value: unknown;
    type?: string;
  }) {
    assert(
      input.value !== undefined && input.name,
      "SECRET_INPUT",
      "Secret name and value are required",
    );
    const ivBytes = randomBytes(12);
    const iv = ivBytes as unknown as Parameters<typeof createCipheriv>[2];
    const key = this.masterKey as unknown as Parameters<
      typeof createCipheriv
    >[1];
    const cipher = createCipheriv(
      "aes-256-gcm",
      key,
      iv,
    ) as unknown as CipherGCM;
    const plaintext = Buffer.from(String(input.value)) as unknown as Parameters<
      CipherGCM["update"]
    >[0];
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ] as unknown as Parameters<typeof Buffer.concat>[0]);
    const record: SecretRecord = {
      id: IdGenerator.create("cred"),
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name,
      type: input.type ?? "generic",
      iv: ivBytes.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      createdAt: new Date().toISOString(),
      rotatedAt: null,
    };
    this.recordStore.set(record.id, record);
    return this.inspect(record.id);
  }

  read(id: string): string {
    const record = this.recordStore.get(id);
    assert(record, "SECRET_NOT_FOUND", "Secret not found");
    const key = this.masterKey as unknown as Parameters<
      typeof createDecipheriv
    >[1];
    const ivBytes = Buffer.from(record.iv, "base64url");
    const iv = ivBytes as unknown as Parameters<typeof createDecipheriv>[2];
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      iv,
    ) as unknown as DecipherGCM;
    const tag = Buffer.from(record.tag, "base64url") as unknown as Parameters<
      DecipherGCM["setAuthTag"]
    >[0];
    decipher.setAuthTag(tag);
    const encrypted = Buffer.from(record.ciphertext, "base64url");
    const decryptUpdate = decipher.update.bind(decipher) as unknown as (
      data: unknown,
    ) => Buffer;
    const value = Buffer.concat([
      decryptUpdate(encrypted),
      decipher.final(),
    ] as unknown as Parameters<typeof Buffer.concat>[0]);
    return value.toString("utf8");
  }

  inspect(id: string) {
    const record = this.recordStore.get(id);
    assert(record, "SECRET_NOT_FOUND", "Secret not found");
    const { ciphertext: _ciphertext, iv: _iv, tag: _tag, ...safe } = record;
    return { ...safe, redacted: true as const };
  }

  rotate(id: string, value: unknown) {
    const record = this.recordStore.get(id);
    assert(record, "SECRET_NOT_FOUND", "Secret not found");
    this.recordStore.delete(id);
    return this.put({
      organizationId: record.organizationId,
      projectId: record.projectId,
      name: record.name,
      type: record.type,
      value,
    });
  }

  list(organizationId?: string) {
    return [...this.recordStore.values()]
      .filter(
        (record) => !organizationId || record.organizationId === organizationId,
      )
      .map((record) => this.inspect(record.id));
  }
}
