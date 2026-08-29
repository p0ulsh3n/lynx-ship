import { createHash, createHmac } from "node:crypto";

export const MAX_TOKEN_BYTES = 4096;

export const MAX_DATA_KEYS = 64;

export const MAX_DATA_VALUE_BYTES = 2048;

export const MAX_PAYLOAD_BYTES = 4096;

export const MAX_FANOUT = 1000;

export const DEFAULT_TTL_SECONDS = 86_400;

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export const FCM_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";

export type Clock = () => number;

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

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function base64Url(value: Buffer | string): string {
  return typeof value === "string"
    ? Buffer.from(value, "utf8").toString("base64url")
    : value.toString("base64url");
}

export function jsonBase64Url(value: unknown): string {
  return base64Url(JSON.stringify(value));
}

export function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new NotificationError("INVALID_INPUT", `${name} is invalid`);
}

export function validateToken(input: RegisterPushTokenInput): void {
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

export function validateMasterKey(value: Buffer | string): Buffer {
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

export function tokenHash(key: Buffer, token: string): string {
  return createHmac(
    "sha256",
    key as unknown as Parameters<typeof createHmac>[1],
  )
    .update(token, "utf8")
    .digest("hex");
}

export function validateNotificationText(
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

export function validateImageUrl(value: string): void {
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

export function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

export function validateProviderDestination(
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

export function assertHttps(value: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new NotificationError("INVALID_URL", `${name} is invalid`);
  }
  if (parsed.protocol !== "https:")
    throw new NotificationError("INVALID_URL", `${name} must use https://`);
}

export function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function parseProviderError(value: string): { code: string | null } {
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
