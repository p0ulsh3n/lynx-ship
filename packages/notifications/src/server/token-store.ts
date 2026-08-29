import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";
import { Pool } from "pg";
import {
  NotificationError,
  tokenHash,
  validateMasterKey,
  validateToken,
  type Clock,
  type EncryptedPushDestination,
  type PushDestination,
  type PushTokenStore,
  type PublicPushDestination,
  type RegisterPushTokenInput,
} from "./core.js";

export class EncryptedPushTokenStore implements PushTokenStore {
  readonly records = new Map<string, EncryptedPushDestination>();

  private readonly key: Buffer;

  private readonly now: Clock;

  constructor(masterKey: Buffer | string, now: Clock = Date.now) {
    this.key = validateMasterKey(masterKey);
    this.now = now;
  }

  async register(
    input: RegisterPushTokenInput,
  ): Promise<PublicPushDestination> {
    validateToken(input);
    const hash = tokenHash(this.key, input.token);
    const id = createHash("sha256")
      .update(
        `${input.organizationId}:${input.projectId}:${input.userId}:${input.platform}:${input.appId}:${input.environment}:${hash}`,
      )
      .digest("hex");
    const now = new Date(this.now()).toISOString();
    const existing = this.records.get(id);
    const encrypted = this.encrypt(input.token, input);
    const record: EncryptedPushDestination = {
      id,
      userId: input.userId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      platform: input.platform,
      appId: input.appId,
      environment: input.environment,
      tokenHash: hash,
      iv: encrypted.iv,
      tag: encrypted.tag,
      ciphertext: encrypted.ciphertext,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      disabledAt: null,
    };
    this.records.set(id, record);
    return this.publicRecord(record);
  }

  async listActive(input: {
    userId: string;
    organizationId: string;
    projectId: string;
  }): Promise<PushDestination[]> {
    return [...this.records.values()]
      .filter(
        (record) =>
          !record.disabledAt &&
          record.userId === input.userId &&
          record.organizationId === input.organizationId &&
          record.projectId === input.projectId,
      )
      .map((record) => ({
        id: record.id,
        userId: record.userId,
        organizationId: record.organizationId,
        projectId: record.projectId,
        platform: record.platform,
        appId: record.appId,
        environment: record.environment,
        token: this.decrypt(record),
      }));
  }

  async markDelivered(id: string, at = new Date(this.now()).toISOString()) {
    const record = this.records.get(id);
    if (!record)
      throw new NotificationError("TOKEN_NOT_FOUND", "Token not found");
    record.lastSuccessAt = at;
    record.updatedAt = at;
  }

  async disable(id: string, at = new Date(this.now()).toISOString()) {
    const record = this.records.get(id);
    if (!record)
      throw new NotificationError("TOKEN_NOT_FOUND", "Token not found");
    record.disabledAt = at;
    record.updatedAt = at;
  }

  snapshot(): PublicPushDestination[] {
    return [...this.records.values()].map((record) =>
      this.publicRecord(record),
    );
  }

  snapshotEncrypted(): EncryptedPushDestination[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  private encrypt(token: string, input: RegisterPushTokenInput) {
    const iv = randomBytes(12);
    const aad = `${input.organizationId}:${input.projectId}:${input.platform}:${input.appId}`;
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.key as unknown as Parameters<typeof createCipheriv>[1],
      iv as unknown as Parameters<typeof createCipheriv>[2],
    ) as unknown as CipherGCM;
    cipher.setAAD(
      Buffer.from(aad, "utf8") as unknown as Parameters<
        typeof cipher.setAAD
      >[0],
    );
    const ciphertext = Buffer.concat([
      cipher.update(token, "utf8") as unknown as Uint8Array<ArrayBufferLike>,
      cipher.final() as unknown as Uint8Array<ArrayBufferLike>,
    ] as unknown as Parameters<typeof Buffer.concat>[0]);
    return {
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
  }

  private decrypt(record: EncryptedPushDestination): string {
    const aad = `${record.organizationId}:${record.projectId}:${record.platform}:${record.appId}`;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key as unknown as Parameters<typeof createDecipheriv>[1],
      Buffer.from(record.iv, "base64url") as unknown as Parameters<
        typeof createDecipheriv
      >[2],
    ) as unknown as DecipherGCM;
    decipher.setAAD(
      Buffer.from(aad, "utf8") as unknown as Parameters<
        typeof decipher.setAAD
      >[0],
    );
    decipher.setAuthTag(
      Buffer.from(record.tag, "base64url") as unknown as Parameters<
        typeof decipher.setAuthTag
      >[0],
    );
    const decryptUpdate = decipher.update.bind(decipher) as unknown as (
      data: Uint8Array<ArrayBufferLike>,
    ) => Uint8Array<ArrayBufferLike>;
    return Buffer.concat([
      decryptUpdate(
        Buffer.from(
          record.ciphertext,
          "base64url",
        ) as unknown as Uint8Array<ArrayBufferLike>,
      ),
      decipher.final() as unknown as Uint8Array<ArrayBufferLike>,
    ] as unknown as Parameters<typeof Buffer.concat>[0]).toString("utf8");
  }

  private publicRecord(
    record: EncryptedPushDestination,
  ): PublicPushDestination {
    const {
      iv: _iv,
      tag: _tag,
      ciphertext: _ciphertext,
      ...publicRecord
    } = record;
    return publicRecord;
  }
}

export class PostgresPushTokenStore implements PushTokenStore {
  private readonly pool: Pool;

  private readonly local: EncryptedPushTokenStore;

  private initialized: Promise<void> | null = null;

  constructor(
    url: string,
    masterKey: Buffer | string,
    options: { now?: Clock; pool?: Pool } = {},
  ) {
    this.pool =
      options.pool ??
      new Pool({
        connectionString: url,
        max: 10,
        application_name: "lynxship-notifications",
      });
    this.local = new EncryptedPushTokenStore(masterKey, options.now);
  }

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = this.load();
    await this.initialized;
  }

  async register(
    input: RegisterPushTokenInput,
  ): Promise<PublicPushDestination> {
    await this.initialize();
    const result = await this.local.register(input);
    const record = this.local.records.get(result.id);
    if (!record)
      throw new NotificationError(
        "TOKEN_NOT_FOUND",
        "Token registration failed",
      );
    await this.pool.query(
      `
        INSERT INTO lynxship_push_tokens
          (id, user_id, organization_id, project_id, platform, app_id,
           environment, token_hash, iv, tag, ciphertext, created_at,
           updated_at, last_success_at, disabled_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (id) DO UPDATE SET
          iv = EXCLUDED.iv,
          tag = EXCLUDED.tag,
          ciphertext = EXCLUDED.ciphertext,
          updated_at = EXCLUDED.updated_at,
          disabled_at = NULL
      `,
      [
        record.id,
        record.userId,
        record.organizationId,
        record.projectId,
        record.platform,
        record.appId,
        record.environment,
        record.tokenHash,
        record.iv,
        record.tag,
        record.ciphertext,
        record.createdAt,
        record.updatedAt,
        record.lastSuccessAt,
        record.disabledAt,
      ],
    );
    return result;
  }

  async listActive(input: {
    userId: string;
    organizationId: string;
    projectId: string;
  }): Promise<PushDestination[]> {
    await this.initialize();
    return this.local.listActive(input);
  }

  async markDelivered(id: string, at?: string): Promise<void> {
    await this.initialize();
    await this.local.markDelivered(id, at);
    const record = this.local.records.get(id);
    if (record)
      await this.pool.query(
        "UPDATE lynxship_push_tokens SET last_success_at = $2, updated_at = $2 WHERE id = $1",
        [id, record.updatedAt],
      );
  }

  async disable(id: string, at?: string): Promise<void> {
    await this.initialize();
    await this.local.disable(id, at);
    const record = this.local.records.get(id);
    if (record)
      await this.pool.query(
        "UPDATE lynxship_push_tokens SET disabled_at = $2, updated_at = $2 WHERE id = $1",
        [id, record.disabledAt],
      );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async load(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS lynxship_push_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'harmony')),
        app_id TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
        token_hash TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        last_success_at TIMESTAMPTZ,
        disabled_at TIMESTAMPTZ,
        UNIQUE (organization_id, project_id, user_id, platform, app_id, environment, token_hash)
      )
    `);
    await this.pool.query(`
      ALTER TABLE lynxship_push_tokens
        DROP CONSTRAINT IF EXISTS lynxship_push_tokens_platform_check
    `);
    await this.pool.query(`
      ALTER TABLE lynxship_push_tokens
        ADD CONSTRAINT lynxship_push_tokens_platform_check
        CHECK (platform IN ('android', 'ios', 'harmony'))
    `);
    const result = await this.pool.query<EncryptedPushDestination>(`
      SELECT
        id,
        user_id AS "userId",
        organization_id AS "organizationId",
        project_id AS "projectId",
        platform,
        app_id AS "appId",
        environment,
        token_hash AS "tokenHash",
        iv,
        tag,
        ciphertext,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_success_at AS "lastSuccessAt",
        disabled_at AS "disabledAt"
      FROM lynxship_push_tokens
    `);
    this.local.records.clear();
    for (const record of result.rows)
      this.local.records.set(record.id, {
        ...record,
        createdAt: new Date(record.createdAt).toISOString(),
        updatedAt: new Date(record.updatedAt).toISOString(),
        lastSuccessAt: record.lastSuccessAt
          ? new Date(record.lastSuccessAt).toISOString()
          : null,
        disabledAt: record.disabledAt
          ? new Date(record.disabledAt).toISOString()
          : null,
      });
  }
}
