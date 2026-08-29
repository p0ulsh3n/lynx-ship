import {
  DEFAULT_TTL_SECONDS,
  MAX_DATA_KEYS,
  MAX_DATA_VALUE_BYTES,
  MAX_PAYLOAD_BYTES,
  NotificationError,
  utf8Bytes,
  validateImageUrl,
} from "./core.js";
import type { PushPayload } from "./payloads.js";

export function validatePayload(payload: PushPayload): void {
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

export { DEFAULT_TTL_SECONDS, MAX_PAYLOAD_BYTES };
