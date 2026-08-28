import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createSign,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";
import { connect as connectHttp2, type ClientHttp2Session } from "node:http2";
import { Pool } from "pg";

const MAX_TOKEN_BYTES = 4096;
const MAX_DATA_KEYS = 64;
const MAX_DATA_VALUE_BYTES = 2048;
const MAX_PAYLOAD_BYTES = 4096;
const MAX_SYNC_PAGE_BYTES = 256 * 1024;
const MAX_SYNC_EVENTS = 100;
const MAX_FANOUT = 1000;
const DEFAULT_TTL_SECONDS = 86_400;
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";

type Clock = () => number;

export type NotificationPlatform = "android" | "ios" | "harmony";

export type NotificationEnvironment = "development" | "production";

export type NotificationKind = "alert" | "background";

export class NotificationError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "INVALID_URL"
    | "TOKEN_NOT_FOUND"
    | "PERMISSION_DENIED"
    | "PROVIDER_AUTH"
    | "PROVIDER_REJECTED"
    | "PROVIDER_UNAVAILABLE"
    | "PAYLOAD_TOO_LARGE"
    | "FANOUT_LIMIT"
    | "SYNC_INVALID";

  readonly permanent: boolean;

  constructor(
    code: NotificationError["code"],
    message: string,
    options: { cause?: unknown; permanent?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "NotificationError";
    this.code = code;
    this.permanent = options.permanent ?? false;
  }
}

export interface PushDestination {
  id: string;
  userId: string;
  organizationId: string;
  projectId: string;
  platform: NotificationPlatform;
  appId: string;
  environment: NotificationEnvironment;
  token: string;
}

export interface PublicPushDestination extends Omit<PushDestination, "token"> {
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  disabledAt: string | null;
}

export interface RegisterPushTokenInput {
  userId: string;
  organizationId: string;
  projectId: string;
  platform: NotificationPlatform;
  appId: string;
  environment: NotificationEnvironment;
  token: string;
}

export interface EncryptedPushDestination extends Omit<
  PublicPushDestination,
  "tokenHash"
> {
  tokenHash: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface PushTokenStore {
  register(input: RegisterPushTokenInput): Promise<PublicPushDestination>;
  listActive(input: {
    userId: string;
    organizationId: string;
    projectId: string;
  }): Promise<PushDestination[]>;
  markDelivered(id: string, at?: string): Promise<void>;
  disable(id: string, at?: string): Promise<void>;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function base64Url(value: Buffer | string): string {
  return typeof value === "string"
    ? Buffer.from(value, "utf8").toString("base64url")
    : value.toString("base64url");
}

function jsonBase64Url(value: unknown): string {
  return base64Url(JSON.stringify(value));
}

function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new NotificationError("INVALID_INPUT", `${name} is invalid`);
}

function validateToken(input: RegisterPushTokenInput): void {
  validateIdentifier(input.userId, "userId");
  validateIdentifier(input.organizationId, "organizationId");
  validateIdentifier(input.projectId, "projectId");
  validateIdentifier(input.appId, "appId");
  if (
    input.platform !== "android" &&
    input.platform !== "ios" &&
    input.platform !== "harmony"
  )
    throw new NotificationError("INVALID_INPUT", "platform is invalid");
  if (input.environment !== "development" && input.environment !== "production")
    throw new NotificationError("INVALID_INPUT", "environment is invalid");
  if (
    !input.token ||
    utf8Bytes(input.token) > MAX_TOKEN_BYTES ||
    /[\u0000-\u001f\u007f]/.test(input.token)
  )
    throw new NotificationError("INVALID_INPUT", "push token is invalid");
  if (input.platform === "ios" && !/^[a-f0-9]+$/i.test(input.token))
    throw new NotificationError(
      "INVALID_INPUT",
      "iOS device tokens must be hexadecimal",
    );
}

function validateMasterKey(value: Buffer | string): Buffer {
  const key = Buffer.isBuffer(value)
    ? Buffer.from(value as unknown as Uint8Array<ArrayBuffer>)
    : createHash("sha256").update(value).digest();
  if (key.length !== 32)
    throw new NotificationError(
      "INVALID_INPUT",
      "notification token encryption key must be 32 bytes",
    );
  return key;
}

function tokenHash(key: Buffer, token: string): string {
  return createHmac(
    "sha256",
    key as unknown as Parameters<typeof createHmac>[1],
  )
    .update(token, "utf8")
    .digest("hex");
}

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

export interface PushPayload {
  title?: string;
  /** Optional secondary title used by APNs communication notifications. */
  subtitle?: string;
  body?: string;
  /** HTTPS image URL used by rich Android/iOS notification integrations. */
  imageUrl?: string;
  data?: Record<string, string>;
  kind?: NotificationKind;
  collapseId?: string;
  /** APNs thread-id / conversation grouping identifier. */
  threadId?: string;
  ttlSeconds?: number;
  badge?: number;
  sound?: string;
}

export interface PresenceActivityPushInput {
  eventId: string;
  conversationId: string;
  actorId: string;
  kind: "typing" | "recording";
  displayName: string;
  /** Optional public HTTPS avatar URL for rich native notifications. */
  avatarUrl?: string;
  route: string;
}

export interface MessagePushInput {
  eventId: string;
  messageId: string;
  conversationId: string;
  actorId: string;
  displayName: string;
  /** Optional public HTTPS avatar URL for rich native notifications. */
  avatarUrl?: string;
  body: string;
  /** Optional group name shown as the communication-notification subtitle. */
  conversationName?: string;
  route: string;
}

/**
 * Build a user-visible message notification that carries only routing and
 * identity metadata in the push payload. The message is still authorized and
 * fetched from the application's backend after the user opens it.
 */
export function createMessagePushPayload(input: MessagePushInput): PushPayload {
  validateIdentifier(input.eventId, "eventId");
  validateIdentifier(input.messageId, "messageId");
  validateIdentifier(input.conversationId, "conversationId");
  validateIdentifier(input.actorId, "actorId");
  validateNotificationText(input.displayName, "displayName", 512);
  validateNotificationText(input.body, "body", 2048);
  if (input.avatarUrl !== undefined) validateImageUrl(input.avatarUrl);
  if (input.conversationName !== undefined)
    validateNotificationText(input.conversationName, "conversationName", 512);
  validateNotificationText(input.route, "route", 512);
  return {
    kind: "alert",
    title: input.displayName.trim(),
    body: input.body,
    ...(input.conversationName
      ? { subtitle: input.conversationName.trim() }
      : {}),
    ...(input.avatarUrl ? { imageUrl: input.avatarUrl } : {}),
    threadId: `conversation-${createHash("sha256")
      .update(input.conversationId)
      .digest("hex")
      .slice(0, 32)}`,
    data: {
      type: "chat.message",
      eventId: input.eventId,
      messageId: input.messageId,
      conversationId: input.conversationId,
      actorId: input.actorId,
      route: input.route,
    },
  };
}

/**
 * Build a short-lived, coalescible alert for presence while the app is not
 * active. The caller still has to authorize the recipient and call PushService.
 */
export function createPresenceActivityPushPayload(
  input: PresenceActivityPushInput,
): PushPayload {
  validateIdentifier(input.eventId, "eventId");
  validateIdentifier(input.conversationId, "conversationId");
  validateIdentifier(input.actorId, "actorId");
  if (input.kind !== "typing" && input.kind !== "recording")
    throw new NotificationError("INVALID_INPUT", "presence kind is invalid");
  if (input.avatarUrl !== undefined) validateImageUrl(input.avatarUrl);
  if (
    !input.displayName.trim() ||
    utf8Bytes(input.displayName) > 512 ||
    /[\u0000-\u001f\u007f]/.test(input.displayName)
  )
    throw new NotificationError(
      "INVALID_INPUT",
      "presence displayName is invalid",
    );
  if (
    !input.route ||
    utf8Bytes(input.route) > 512 ||
    /[\u0000-\u001f\u007f]/.test(input.route)
  )
    throw new NotificationError("INVALID_INPUT", "presence route is invalid");
  const action = input.kind === "typing" ? "is typing" : "is recording";
  const collapseId = createHash("sha256")
    .update(`${input.conversationId}:${input.actorId}:${input.kind}`)
    .digest("hex")
    .slice(0, 32);
  return {
    kind: "alert",
    title: input.displayName.trim(),
    body: action,
    ...(input.avatarUrl ? { imageUrl: input.avatarUrl } : {}),
    collapseId: `presence-${collapseId}`,
    ttlSeconds: 10,
    data: {
      type: "presence.activity",
      eventId: input.eventId,
      conversationId: input.conversationId,
      actorId: input.actorId,
      kind: input.kind,
      route: input.route,
    },
  };
}

export interface PresenceActivityPushRequest extends PresenceActivityPushInput {
  /** Recipients already authorized by the application's conversation service. */
  recipientUserIds: readonly string[];
}

export interface PresenceActivityPushSender {
  sendToUser(input: SendToUserInput): Promise<SendToUserResult>;
}

export interface PresenceActivityPushRouterOptions {
  sender: PresenceActivityPushSender;
  organizationId: string;
  projectId: string;
  /** Required policy for membership, opt-in and foreground suppression. */
  shouldNotify: (
    recipientUserId: string,
    activity: PresenceActivityPushInput,
  ) => boolean | Promise<boolean>;
  now?: Clock;
  dedupeMs?: number;
  maxRecipients?: number;
}

export interface PresenceActivityPushRouterResult {
  attemptedRecipients: number;
  skippedRecipients: number;
  acceptedDevices: number;
  disabledDevices: number;
  failures: Array<{
    recipientUserId: string;
    destinationId?: string;
    code: NotificationError["code"];
  }>;
}

/**
 * Routes short-lived typing/recording alerts to authorized background users.
 * It never discovers group membership or bypasses the application's policy.
 */
export class PresenceActivityPushRouter {
  private readonly sender: PresenceActivityPushSender;

  private readonly organizationId: string;

  private readonly projectId: string;

  private readonly shouldNotify: PresenceActivityPushRouterOptions["shouldNotify"];

  private readonly now: Clock;

  private readonly dedupeMs: number;

  private readonly maxRecipients: number;

  private readonly recent = new Map<string, number>();

  constructor(options: PresenceActivityPushRouterOptions) {
    validateIdentifier(options.organizationId, "organizationId");
    validateIdentifier(options.projectId, "projectId");
    this.sender = options.sender;
    this.organizationId = options.organizationId;
    this.projectId = options.projectId;
    this.shouldNotify = options.shouldNotify;
    this.now = options.now ?? Date.now;
    this.dedupeMs = options.dedupeMs ?? 10_000;
    if (!Number.isSafeInteger(this.dedupeMs) || this.dedupeMs < 0)
      throw new NotificationError(
        "INVALID_INPUT",
        "presence dedupeMs must be a non-negative integer",
      );
    this.maxRecipients = Math.min(
      options.maxRecipients ?? MAX_FANOUT,
      MAX_FANOUT,
    );
    if (!Number.isSafeInteger(this.maxRecipients) || this.maxRecipients < 1)
      throw new NotificationError(
        "INVALID_INPUT",
        "presence maxRecipients must be positive",
      );
  }

  async notify(
    request: PresenceActivityPushRequest,
  ): Promise<PresenceActivityPushRouterResult> {
    const payload = createPresenceActivityPushPayload(request);
    const recipients = [...new Set(request.recipientUserIds)];
    if (recipients.length > this.maxRecipients)
      throw new NotificationError(
        "FANOUT_LIMIT",
        "presence notification fan-out exceeds the configured limit",
      );
    const result: PresenceActivityPushRouterResult = {
      attemptedRecipients: 0,
      skippedRecipients: 0,
      acceptedDevices: 0,
      disabledDevices: 0,
      failures: [],
    };
    const now = this.now();
    this.prune(now);
    for (const recipientUserId of recipients) {
      validateIdentifier(recipientUserId, "recipientUserId");
      if (recipientUserId === request.actorId) {
        result.skippedRecipients += 1;
        continue;
      }
      const key = `${recipientUserId}\u0000${request.conversationId}\u0000${request.actorId}\u0000${request.kind}`;
      const lastSentAt = this.recent.get(key);
      if (lastSentAt !== undefined && now - lastSentAt < this.dedupeMs) {
        result.skippedRecipients += 1;
        continue;
      }
      if (!(await this.shouldNotify(recipientUserId, request))) {
        result.skippedRecipients += 1;
        continue;
      }
      result.attemptedRecipients += 1;
      try {
        const sent = await this.sender.sendToUser({
          userId: recipientUserId,
          organizationId: this.organizationId,
          projectId: this.projectId,
          payload,
        });
        this.recent.set(key, now);
        result.acceptedDevices += sent.accepted;
        result.disabledDevices += sent.disabled;
        result.failures.push(
          ...sent.failures.map((failure) => ({
            recipientUserId,
            destinationId: failure.destinationId,
            code: failure.code,
          })),
        );
      } catch (error) {
        const typed =
          error instanceof NotificationError
            ? error
            : new NotificationError(
                "PROVIDER_UNAVAILABLE",
                "Presence notification routing failed",
                { cause: error },
              );
        result.failures.push({ recipientUserId, code: typed.code });
      }
    }
    return result;
  }

  clear(): void {
    this.recent.clear();
  }

  private prune(now: number): void {
    for (const [key, sentAt] of this.recent) {
      if (now - sentAt >= this.dedupeMs) this.recent.delete(key);
    }
  }
}

export interface PushSendRequest {
  destination: PushDestination;
  payload: PushPayload;
}

export interface PushSendResult {
  provider: "fcm" | "apns" | "huawei";
  destinationId: string;
  accepted: boolean;
  providerMessageId?: string;
}

export interface PushProvider {
  readonly name: "fcm" | "apns" | "huawei";
  readonly platform: NotificationPlatform;
  send(request: PushSendRequest): Promise<PushSendResult>;
  close?(): Promise<void>;
}

function validatePayload(payload: PushPayload): void {
  if (
    payload.kind !== undefined &&
    payload.kind !== "alert" &&
    payload.kind !== "background"
  )
    throw new NotificationError(
      "INVALID_INPUT",
      "notification kind is invalid",
    );
  if (
    payload.kind === "background" &&
    (payload.title ||
      payload.subtitle ||
      payload.body ||
      payload.sound ||
      payload.imageUrl)
  )
    throw new NotificationError(
      "INVALID_INPUT",
      "background notifications cannot contain alert fields",
    );
  if (payload.title && utf8Bytes(payload.title) > 512)
    throw new NotificationError(
      "INVALID_INPUT",
      "notification title is too long",
    );
  if (payload.subtitle && utf8Bytes(payload.subtitle) > 512)
    throw new NotificationError(
      "INVALID_INPUT",
      "notification subtitle is too long",
    );
  if (payload.body && utf8Bytes(payload.body) > 2048)
    throw new NotificationError(
      "INVALID_INPUT",
      "notification body is too long",
    );
  if (payload.imageUrl !== undefined) validateImageUrl(payload.imageUrl);
  if (
    payload.threadId !== undefined &&
    !/^[A-Za-z0-9_.:-]{1,64}$/.test(payload.threadId)
  )
    throw new NotificationError("INVALID_INPUT", "threadId is invalid");
  if (payload.data) {
    const entries = Object.entries(payload.data);
    if (entries.length > MAX_DATA_KEYS)
      throw new NotificationError(
        "INVALID_INPUT",
        "too many notification data keys",
      );
    for (const [key, value] of entries) {
      if (
        !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(key) ||
        typeof value !== "string"
      )
        throw new NotificationError(
          "INVALID_INPUT",
          "notification data is invalid",
        );
      if (utf8Bytes(value) > MAX_DATA_VALUE_BYTES)
        throw new NotificationError(
          "INVALID_INPUT",
          "notification data value is too long",
        );
    }
  }
  if (payload.collapseId && !/^[A-Za-z0-9_.:-]{1,64}$/.test(payload.collapseId))
    throw new NotificationError("INVALID_INPUT", "collapseId is invalid");
  if (
    payload.ttlSeconds !== undefined &&
    (!Number.isSafeInteger(payload.ttlSeconds) ||
      payload.ttlSeconds < 0 ||
      payload.ttlSeconds > 2_419_200)
  )
    throw new NotificationError("INVALID_INPUT", "ttlSeconds is invalid");
  if (
    payload.badge !== undefined &&
    (!Number.isSafeInteger(payload.badge) || payload.badge < 0)
  )
    throw new NotificationError("INVALID_INPUT", "badge is invalid");
}

function validateNotificationText(
  value: string,
  field: string,
  maxBytes: number,
): void {
  if (
    !value.trim() ||
    utf8Bytes(value) > maxBytes ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new NotificationError(
      "INVALID_INPUT",
      `notification ${field} is invalid`,
    );
}

function validateImageUrl(value: string): void {
  if (!value || utf8Bytes(value) > 2048)
    throw new NotificationError(
      "INVALID_INPUT",
      "notification image URL is invalid",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new NotificationError(
      "INVALID_URL",
      "notification image URL is invalid",
      {
        cause: error,
      },
    );
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new NotificationError(
      "INVALID_URL",
      "notification image URL must use HTTPS without embedded credentials",
    );
}

function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

function validateProviderDestination(
  destination: PushDestination,
  platform: NotificationPlatform,
): void {
  validateIdentifier(destination.id, "destination.id");
  validateIdentifier(destination.appId, "destination.appId");
  if (destination.platform !== platform)
    throw new NotificationError(
      "INVALID_INPUT",
      "destination platform does not match provider",
    );
  if (!destination.token)
    throw new NotificationError("INVALID_INPUT", "destination token is empty");
}

export class PushProviderError extends NotificationError {
  readonly providerCode: string | null;

  constructor(
    code: NotificationError["code"],
    message: string,
    options: {
      providerCode?: string | null;
      cause?: unknown;
      permanent?: boolean;
    } = {},
  ) {
    super(code, message, options);
    this.providerCode = options.providerCode ?? null;
  }
}

export interface FcmServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export class FcmProvider implements PushProvider {
  readonly name = "fcm" as const;

  readonly platform = "android" as const;

  private readonly account: FcmServiceAccount;

  private readonly fetchImpl: typeof fetch;

  private readonly now: Clock;

  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    account: FcmServiceAccount,
    options: { fetch?: typeof fetch; now?: Clock } = {},
  ) {
    validateIdentifier(account.projectId, "projectId");
    if (!account.clientEmail || !account.privateKey)
      throw new NotificationError(
        "INVALID_INPUT",
        "FCM service account is incomplete",
      );
    this.account = account;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async send(request: PushSendRequest): Promise<PushSendResult> {
    validateProviderDestination(request.destination, this.platform);
    validatePayload(request.payload);
    const message: Record<string, unknown> = {
      token: request.destination.token,
      data: request.payload.data ?? {},
    };
    if (
      request.payload.kind !== "background" &&
      (request.payload.title || request.payload.body)
    )
      message.notification = {
        ...(request.payload.title ? { title: request.payload.title } : {}),
        ...(request.payload.body ? { body: request.payload.body } : {}),
        ...(request.payload.imageUrl
          ? { image: request.payload.imageUrl }
          : {}),
      };
    message.android = {
      priority: request.payload.kind === "background" ? "NORMAL" : "HIGH",
      ttl: `${request.payload.ttlSeconds ?? DEFAULT_TTL_SECONDS}s`,
      ...(request.payload.collapseId
        ? { collapseKey: request.payload.collapseId }
        : {}),
    };
    if (jsonBytes({ message }) > MAX_PAYLOAD_BYTES)
      throw new NotificationError(
        "PAYLOAD_TOO_LARGE",
        "FCM payload exceeds 4096 bytes",
      );
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.projectId)}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message }),
        },
      );
    } catch (error) {
      throw new PushProviderError(
        "PROVIDER_UNAVAILABLE",
        "FCM request failed",
        { cause: error },
      );
    }
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseProviderError(text);
      const permanent = ["UNREGISTERED", "SENDER_ID_MISMATCH"].includes(
        parsed.code ?? "",
      );
      throw new PushProviderError(
        response.status === 401 || response.status === 403
          ? "PROVIDER_AUTH"
          : "PROVIDER_REJECTED",
        "FCM rejected the notification",
        { providerCode: parsed.code, permanent },
      );
    }
    const parsed = safeJson(text) as { name?: unknown } | null;
    return {
      provider: this.name,
      destinationId: request.destination.id,
      accepted: true,
      ...(typeof parsed?.name === "string"
        ? { providerMessageId: parsed.name }
        : {}),
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000)
      return this.accessToken.value;
    const issuedAt = Math.floor(now / 1000);
    const assertionHeader = jsonBase64Url({ alg: "RS256", typ: "JWT" });
    const assertionPayload = jsonBase64Url({
      iss: this.account.clientEmail,
      scope: FCM_SCOPE,
      aud: FCM_TOKEN_AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + 3_600,
    });
    const signer = createSign("RSA-SHA256");
    signer.update(`${assertionHeader}.${assertionPayload}`);
    const assertion = `${assertionHeader}.${assertionPayload}.${base64Url(signer.sign(this.account.privateKey))}`;
    let response: Response;
    try {
      response = await this.fetchImpl(FCM_TOKEN_AUDIENCE, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });
    } catch (error) {
      throw new PushProviderError(
        "PROVIDER_UNAVAILABLE",
        "FCM authentication request failed",
        { cause: error },
      );
    }
    const text = await response.text();
    if (!response.ok)
      throw new PushProviderError(
        "PROVIDER_AUTH",
        "FCM authentication failed",
        { providerCode: "OAUTH_REJECTED" },
      );
    const parsed = safeJson(text) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (
      typeof parsed?.access_token !== "string" ||
      typeof parsed.expires_in !== "number" ||
      !Number.isFinite(parsed.expires_in)
    )
      throw new PushProviderError(
        "PROVIDER_AUTH",
        "FCM returned an invalid access token",
      );
    this.accessToken = {
      value: parsed.access_token,
      expiresAt: now + Math.max(60, parsed.expires_in) * 1_000,
    };
    return parsed.access_token;
  }
}

export interface ApnsCredentials {
  teamId: string;
  keyId: string;
  bundleId: string;
  privateKey: string;
  environment: NotificationEnvironment;
}

export class ApnsProvider implements PushProvider {
  readonly name = "apns" as const;

  readonly platform = "ios" as const;

  private readonly credentials: ApnsCredentials;

  private readonly now: Clock;

  private session: ClientHttp2Session | null = null;

  private providerToken: { value: string; expiresAt: number } | null = null;

  constructor(credentials: ApnsCredentials, now: Clock = Date.now) {
    validateIdentifier(credentials.teamId, "teamId");
    validateIdentifier(credentials.keyId, "keyId");
    validateIdentifier(credentials.bundleId, "bundleId");
    if (!credentials.privateKey)
      throw new NotificationError(
        "INVALID_INPUT",
        "APNs private key is required",
      );
    if (
      credentials.environment !== "development" &&
      credentials.environment !== "production"
    )
      throw new NotificationError(
        "INVALID_INPUT",
        "APNs environment is invalid",
      );
    this.credentials = credentials;
    this.now = now;
  }

  async send(request: PushSendRequest): Promise<PushSendResult> {
    validateProviderDestination(request.destination, this.platform);
    validatePayload(request.payload);
    if (!/^[a-f0-9]+$/i.test(request.destination.token))
      throw new NotificationError(
        "INVALID_INPUT",
        "APNs device token is invalid",
      );
    const background = request.payload.kind === "background";
    const aps: Record<string, unknown> = background
      ? { "content-available": 1 }
      : {
          ...(request.payload.title || request.payload.body
            ? {
                alert: {
                  ...(request.payload.title
                    ? { title: request.payload.title }
                    : {}),
                  ...(request.payload.subtitle
                    ? { subtitle: request.payload.subtitle }
                    : {}),
                  ...(request.payload.body
                    ? { body: request.payload.body }
                    : {}),
                },
              }
            : {}),
          ...(request.payload.sound ? { sound: request.payload.sound } : {}),
          ...(request.payload.badge !== undefined
            ? { badge: request.payload.badge }
            : {}),
          ...(request.payload.imageUrl ? { "mutable-content": 1 } : {}),
        };
    const payload = {
      aps,
      ...(request.payload.data ?? {}),
      ...(request.payload.imageUrl
        ? { "lynxship.image-url": request.payload.imageUrl }
        : {}),
    };
    if (jsonBytes(payload) > MAX_PAYLOAD_BYTES)
      throw new NotificationError(
        "PAYLOAD_TOO_LARGE",
        "APNs payload exceeds 4096 bytes",
      );
    const providerToken = this.getProviderToken();
    const authority =
      this.credentials.environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
    const response = await this.sendHttp2(
      authority,
      {
        ":method": "POST",
        ":path": `/3/device/${request.destination.token}`,
        authorization: `bearer ${providerToken}`,
        "apns-topic": this.credentials.bundleId,
        "apns-push-type": background ? "background" : "alert",
        "apns-priority": background ? "5" : "10",
        ...(request.payload.collapseId
          ? { "apns-collapse-id": request.payload.collapseId }
          : {}),
        ...(request.payload.threadId
          ? { "apns-thread-id": request.payload.threadId }
          : {}),
        ...(request.payload.ttlSeconds !== undefined
          ? {
              "apns-expiration": String(
                Math.floor(this.now() / 1_000) + request.payload.ttlSeconds,
              ),
            }
          : {}),
      },
      JSON.stringify(payload),
    );
    if (response.status < 200 || response.status >= 300) {
      const parsed = safeJson(response.body) as { reason?: unknown } | null;
      const reason =
        typeof parsed?.reason === "string" ? parsed.reason : "APNS_REJECTED";
      const permanent = [
        "BadDeviceToken",
        "DeviceTokenNotForTopic",
        "Unregistered",
      ].includes(reason);
      throw new PushProviderError(
        "PROVIDER_REJECTED",
        "APNs rejected the notification",
        { providerCode: reason, permanent },
      );
    }
    return {
      provider: this.name,
      destinationId: request.destination.id,
      accepted: true,
      ...(response.apnsId ? { providerMessageId: response.apnsId } : {}),
    };
  }

  async close(): Promise<void> {
    this.session?.close();
    this.session = null;
  }

  private getProviderToken(): string {
    const now = this.now();
    if (this.providerToken && this.providerToken.expiresAt > now + 60_000)
      return this.providerToken.value;
    const issuedAt = Math.floor(now / 1_000);
    const header = jsonBase64Url({
      alg: "ES256",
      kid: this.credentials.keyId,
      typ: "JWT",
    });
    const payload = jsonBase64Url({
      iss: this.credentials.teamId,
      iat: issuedAt,
    });
    const signer = createSign("SHA256");
    signer.update(`${header}.${payload}`);
    const signature = base64Url(signer.sign(this.credentials.privateKey));
    const value = `${header}.${payload}.${signature}`;
    this.providerToken = { value, expiresAt: now + 50 * 60_000 };
    return value;
  }

  private async sendHttp2(
    authority: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; body: string; apnsId?: string }> {
    const session = this.getSession(authority);
    return new Promise((resolve, reject) => {
      const request = session.request(headers);
      const chunks: string[] = [];
      let status = 0;
      let apnsId: string | undefined;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(
          new PushProviderError("PROVIDER_UNAVAILABLE", "APNs request failed", {
            cause: error,
          }),
        );
      };
      request.setEncoding("utf8");
      request.on("response", (responseHeaders) => {
        status = Number(responseHeaders[":status"] ?? 0);
        const value = responseHeaders["apns-id"];
        if (typeof value === "string") apnsId = value;
      });
      request.on("data", (chunk: string) => chunks.push(chunk));
      request.on("error", fail);
      request.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status,
          body: chunks.join(""),
          ...(apnsId ? { apnsId } : {}),
        });
      });
      request.end(body);
    });
  }

  private getSession(authority: string): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed)
      return this.session;
    this.session = connectHttp2(authority, { rejectUnauthorized: true });
    this.session.on("error", () => {
      this.session = null;
    });
    this.session.on("close", () => {
      this.session = null;
    });
    return this.session;
  }
}

export interface HuaweiPushCredentials {
  /** AppGallery Connect client ID used by the Push Kit REST endpoint. */
  clientId: string;
  /** OAuth client secret. Keep this on the server only. */
  clientSecret: string;
}

export interface HuaweiPushProviderOptions {
  fetch?: typeof fetch;
  now?: Clock;
  /** Test-only or private gateway override; production must remain HTTPS. */
  endpoint?: string;
  tokenEndpoint?: string;
}

/**
 * Huawei Push Kit provider for HarmonyOS push tokens.
 *
 * This uses the documented OAuth client-credentials flow and the standard
 * Push Kit v1 downlink API for notification/data messages. HarmonyOS Next
 * scenario-specific APIs (for example Live View, push-type 7) intentionally
 * remain outside this generic notification contract.
 */
export class HuaweiPushProvider implements PushProvider {
  readonly name = "huawei" as const;

  readonly platform = "harmony" as const;

  private readonly credentials: HuaweiPushCredentials;

  private readonly fetchImpl: typeof fetch;

  private readonly now: Clock;

  private readonly endpoint: string;

  private readonly tokenEndpoint: string;

  private accessToken: { value: string; expiresAt: number } | null = null;

  private accessTokenRequest: Promise<string> | null = null;

  constructor(
    credentials: HuaweiPushCredentials,
    options: HuaweiPushProviderOptions = {},
  ) {
    validateIdentifier(credentials.clientId, "clientId");
    if (!credentials.clientSecret.trim())
      throw new NotificationError(
        "INVALID_INPUT",
        "Huawei Push Kit client secret is required",
      );
    this.credentials = credentials;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.endpoint =
      options.endpoint ??
      `https://push-api.cloud.huawei.com/v1/${encodeURIComponent(credentials.clientId)}/messages:send`;
    this.tokenEndpoint =
      options.tokenEndpoint ??
      "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
    assertHttps(this.endpoint, "Huawei Push Kit endpoint");
    assertHttps(this.tokenEndpoint, "Huawei OAuth endpoint");
  }

  async send(request: PushSendRequest): Promise<PushSendResult> {
    validateProviderDestination(request.destination, this.platform);
    validatePayload(request.payload);
    const background = request.payload.kind === "background";
    const data = JSON.stringify(request.payload.data ?? {});
    const notification =
      !background && (request.payload.title || request.payload.body)
        ? {
            ...(request.payload.title ? { title: request.payload.title } : {}),
            ...(request.payload.body ? { body: request.payload.body } : {}),
            ...(request.payload.imageUrl
              ? { image: request.payload.imageUrl }
              : {}),
          }
        : undefined;
    const androidNotification = notification
      ? {
          ...notification,
          ...(request.payload.sound ? { sound: request.payload.sound } : {}),
        }
      : undefined;
    const message = {
      data,
      ...(notification ? { notification } : {}),
      android: {
        urgency: background ? "NORMAL" : "HIGH",
        ttl: `${request.payload.ttlSeconds ?? DEFAULT_TTL_SECONDS}s`,
        ...(request.payload.collapseId
          ? { collapse_key: request.payload.collapseId }
          : {}),
        ...(androidNotification ? { notification: androidNotification } : {}),
      },
      token: [request.destination.token],
    };
    const body = { validate_only: false, message };
    if (jsonBytes(body) > MAX_PAYLOAD_BYTES)
      throw new NotificationError(
        "PAYLOAD_TOO_LARGE",
        "Huawei Push Kit payload exceeds 4096 bytes",
      );
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new PushProviderError(
        "PROVIDER_UNAVAILABLE",
        "Huawei Push Kit request failed",
        { cause: error },
      );
    }
    const text = await response.text();
    const parsed = safeJson(text) as {
      code?: unknown;
      requestId?: unknown;
    } | null;
    const providerCode = typeof parsed?.code === "string" ? parsed.code : null;
    if (!response.ok || providerCode !== "80000000") {
      // 80100000 can be a partial result caused by policy or message
      // classification, so it is not safe to disable a token automatically.
      // Huawei's 80300007 explicitly means that all supplied tokens are invalid.
      const permanent = providerCode === "80300007";
      const auth =
        response.status === 401 ||
        response.status === 403 ||
        providerCode === "80200001" ||
        providerCode === "80200003";
      throw new PushProviderError(
        auth ? "PROVIDER_AUTH" : "PROVIDER_REJECTED",
        "Huawei Push Kit rejected the notification",
        { providerCode, permanent },
      );
    }
    return {
      provider: this.name,
      destinationId: request.destination.id,
      accepted: true,
      ...(typeof parsed?.requestId === "string"
        ? { providerMessageId: parsed.requestId }
        : {}),
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000)
      return this.accessToken.value;
    if (this.accessTokenRequest) return this.accessTokenRequest;
    this.accessTokenRequest = this.fetchAccessToken(now);
    try {
      return await this.accessTokenRequest;
    } finally {
      this.accessTokenRequest = null;
    }
  }

  private async fetchAccessToken(now: number): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
        }),
      });
    } catch (error) {
      throw new PushProviderError(
        "PROVIDER_UNAVAILABLE",
        "Huawei OAuth request failed",
        { cause: error },
      );
    }
    const text = await response.text();
    if (!response.ok)
      throw new PushProviderError(
        "PROVIDER_AUTH",
        "Huawei OAuth authentication failed",
      );
    const parsed = safeJson(text) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (
      typeof parsed?.access_token !== "string" ||
      !parsed.access_token.trim() ||
      typeof parsed.expires_in !== "number" ||
      !Number.isFinite(parsed.expires_in) ||
      parsed.expires_in <= 0
    )
      throw new PushProviderError(
        "PROVIDER_AUTH",
        "Huawei OAuth returned an invalid access token",
      );
    const value = parsed.access_token.trim();
    this.accessToken = {
      value,
      expiresAt: now + Math.max(60, parsed.expires_in) * 1_000,
    };
    return value;
  }
}

function assertHttps(value: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new NotificationError("INVALID_URL", `${name} is invalid`);
  }
  if (parsed.protocol !== "https:")
    throw new NotificationError("INVALID_URL", `${name} must use https://`);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseProviderError(value: string): { code: string | null } {
  const parsed = safeJson(value) as {
    error?: {
      status?: unknown;
      details?: Array<{ errorCode?: unknown }>;
    };
  } | null;
  const detail = parsed?.error?.details?.find(
    (item) => typeof item.errorCode === "string",
  )?.errorCode;
  const status = parsed?.error?.status;
  return {
    code:
      typeof detail === "string"
        ? detail
        : typeof status === "string"
          ? status
          : null,
  };
}

export interface PushServiceOptions {
  store: PushTokenStore;
  providers: PushProvider[];
  maxFanout?: number;
}

export interface SendToUserInput {
  userId: string;
  organizationId: string;
  projectId: string;
  payload: PushPayload;
}

export interface SendToUserResult {
  attempted: number;
  accepted: number;
  disabled: number;
  failures: Array<{
    destinationId: string;
    code: NotificationError["code"];
  }>;
}

export class PushService {
  private readonly store: PushTokenStore;

  private readonly providers = new Map<NotificationPlatform, PushProvider>();

  private readonly maxFanout: number;

  constructor(options: PushServiceOptions) {
    this.store = options.store;
    this.maxFanout = Math.min(options.maxFanout ?? MAX_FANOUT, MAX_FANOUT);
    if (this.maxFanout < 1)
      throw new NotificationError(
        "INVALID_INPUT",
        "maxFanout must be positive",
      );
    for (const provider of options.providers) {
      if (this.providers.has(provider.platform))
        throw new NotificationError(
          "INVALID_INPUT",
          `duplicate provider for ${provider.platform}`,
        );
      this.providers.set(provider.platform, provider);
    }
  }

  async sendToUser(input: SendToUserInput): Promise<SendToUserResult> {
    validateIdentifier(input.userId, "userId");
    validateIdentifier(input.organizationId, "organizationId");
    validateIdentifier(input.projectId, "projectId");
    validatePayload(input.payload);
    const destinations = await this.store.listActive(input);
    if (destinations.length > this.maxFanout)
      throw new NotificationError(
        "FANOUT_LIMIT",
        "notification fan-out exceeds the configured limit",
      );
    const result: SendToUserResult = {
      attempted: destinations.length,
      accepted: 0,
      disabled: 0,
      failures: [],
    };
    for (const destination of destinations) {
      const provider = this.providers.get(destination.platform);
      if (!provider) {
        result.failures.push({
          destinationId: destination.id,
          code: "PROVIDER_UNAVAILABLE",
        });
        continue;
      }
      try {
        await provider.send({ destination, payload: input.payload });
        await this.store.markDelivered(destination.id);
        result.accepted += 1;
      } catch (error) {
        const typed =
          error instanceof NotificationError
            ? error
            : new NotificationError(
                "PROVIDER_UNAVAILABLE",
                "Notification provider failed",
                { cause: error },
              );
        result.failures.push({
          destinationId: destination.id,
          code: typed.code,
        });
        if (typed.permanent) {
          await this.store.disable(destination.id);
          result.disabled += 1;
        }
      }
    }
    return result;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.providers.values()]
        .filter((provider) => provider.close)
        .map((provider) => provider.close!()),
    );
  }
}

export interface PushDeviceAdapter {
  platform: NotificationPlatform;
  appId: string;
  environment: NotificationEnvironment;
  requestPermission?: () => Promise<boolean>;
  getToken: () => Promise<string | null>;
}

export interface RegisterDeviceTransport {
  register(input: RegisterPushTokenInput): Promise<void>;
}

export class PushRegistrationClient {
  constructor(
    private readonly adapter: PushDeviceAdapter,
    private readonly transport: RegisterDeviceTransport,
    private readonly identity: Omit<
      RegisterPushTokenInput,
      "platform" | "appId" | "environment" | "token"
    >,
  ) {}

  async register(): Promise<
    "registered" | "permission-denied" | "unavailable"
  > {
    if (
      this.adapter.requestPermission &&
      !(await this.adapter.requestPermission())
    )
      return "permission-denied";
    const token = await this.adapter.getToken();
    if (!token) return "unavailable";
    await this.transport.register({
      ...this.identity,
      platform: this.adapter.platform,
      appId: this.adapter.appId,
      environment: this.adapter.environment,
      token,
    });
    return "registered";
  }
}

export interface SyncEnvelope {
  id: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface SyncPage {
  events: SyncEnvelope[];
  nextCursor: string | null;
}

export interface CursorStore {
  get(): Promise<string | null>;
  set(cursor: string): Promise<void>;
}

export class RealtimeCatchUpClient {
  constructor(
    private readonly options: {
      endpoint: string;
      token: string | (() => string | Promise<string>);
      cursorStore: CursorStore;
      fetch?: typeof fetch;
      maxPages?: number;
    },
  ) {
    const parsed = new URL(options.endpoint);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      throw new NotificationError(
        "INVALID_URL",
        "sync endpoint must use https://",
      );
    if (
      parsed.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
      throw new NotificationError(
        "INVALID_URL",
        "production sync endpoint must use https://",
      );
  }

  async sync(
    onEvent: (event: SyncEnvelope) => Promise<void> | void,
  ): Promise<number> {
    const fetchImpl = this.options.fetch ?? fetch;
    const maxPages = Math.min(Math.max(this.options.maxPages ?? 20, 1), 100);
    let cursor = await this.options.cursorStore.get();
    let pages = 0;
    let processed = 0;
    while (pages < maxPages) {
      const url = new URL(this.options.endpoint);
      if (cursor) url.searchParams.set("after", cursor);
      const token =
        typeof this.options.token === "function"
          ? await this.options.token()
          : this.options.token;
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok)
        throw new NotificationError(
          "PROVIDER_UNAVAILABLE",
          "sync request failed",
        );
      const body = await response.text();
      if (utf8Bytes(body) > MAX_SYNC_PAGE_BYTES)
        throw new NotificationError(
          "SYNC_INVALID",
          "sync response exceeds the configured size limit",
        );
      const page = parseSyncPage(body);
      for (const event of page.events) {
        await onEvent(event);
        processed += 1;
      }
      pages += 1;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      await this.options.cursorStore.set(cursor);
    }
    return processed;
  }
}

function parseSyncPage(value: string): SyncPage {
  const parsed = safeJson(value) as {
    events?: unknown;
    nextCursor?: unknown;
  } | null;
  if (!Array.isArray(parsed?.events))
    throw new NotificationError("SYNC_INVALID", "sync response is invalid");
  if (parsed.events.length > MAX_SYNC_EVENTS)
    throw new NotificationError(
      "SYNC_INVALID",
      "sync response contains too many events",
    );
  const events: SyncEnvelope[] = [];
  for (const value of parsed.events) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new NotificationError("SYNC_INVALID", "sync event is invalid");
    const event = value as Record<string, unknown>;
    if (
      typeof event.id !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(event.id) ||
      typeof event.type !== "string" ||
      !/^[a-z][a-z0-9._:-]{0,63}$/.test(event.type) ||
      typeof event.ts !== "number" ||
      !Number.isSafeInteger(event.ts) ||
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    )
      throw new NotificationError(
        "SYNC_INVALID",
        "sync event has an invalid envelope",
      );
    events.push(event as unknown as SyncEnvelope);
  }
  if (parsed.nextCursor !== null && typeof parsed.nextCursor !== "string")
    throw new NotificationError("SYNC_INVALID", "sync cursor is invalid");
  return {
    events,
    nextCursor: parsed.nextCursor as string | null,
  };
}
