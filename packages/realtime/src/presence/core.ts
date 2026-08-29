import { RealtimeError } from "../client.js";
import type { PresenceEvent, PresenceKind, PresenceProfile } from "./models.js";

export type PresencePayload = {
  conversationId: string;
  kind: PresenceKind;
  active: boolean;
};

export const DEFAULT_TYPING_IDLE_MS = 2_500;

export const DEFAULT_HEARTBEAT_MS = 15_000;

export const DEFAULT_MAX_ACTIVE_CONVERSATIONS = 64;

export const MAX_CONVERSATION_ID_LENGTH = 256;

export const MAX_USER_ID_LENGTH = 256;

export const DEFAULT_PRESENCE_TTL_MS = 10_000;

export const DEFAULT_MAX_PRESENCE_TTL_MS = 60_000;

export const DEFAULT_MAX_PARTICIPANTS_PER_CONVERSATION = 256;

export const MAX_DISPLAY_NAME_LENGTH = 120;

export const DEFAULT_ACTIVITY_DEDUPE_MS = 5_000;

export const DEFAULT_ACTIVITY_WINDOW_MS = 30_000;

export const DEFAULT_ACTIVITY_MAX_PER_WINDOW = 20;

export function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RealtimeError(
      "INVALID_CONFIGURATION",
      `${name} must be a positive integer`,
    );
  }
  return value;
}

export function validateConversationId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CONVERSATION_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new RealtimeError(
      "INVALID_MESSAGE",
      "conversationId must be a non-empty safe string",
    );
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePresenceEvent(value: unknown): PresenceEvent | null {
  if (!isRecord(value)) return null;
  const conversationId = value.conversationId;
  const userId = value.userId;
  const kind = value.kind;
  const active = value.active;
  const expiresAt = value.expiresAt;
  if (
    typeof conversationId !== "string" ||
    conversationId.length === 0 ||
    conversationId.length > MAX_CONVERSATION_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(conversationId) ||
    typeof userId !== "string" ||
    userId.length === 0 ||
    userId.length > MAX_USER_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(userId) ||
    (kind !== "typing" && kind !== "recording") ||
    typeof active !== "boolean" ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== "number" ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt < 0))
  ) {
    return null;
  }
  return {
    conversationId,
    userId,
    kind,
    active,
    ...(typeof expiresAt === "number" ? { expiresAt } : {}),
  };
}

export type ActivePresence = {
  kind: PresenceKind;
  expiresAt: number;
};

export function validateUserId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_USER_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new RealtimeError(
      "INVALID_MESSAGE",
      "userId must be a non-empty safe string",
    );
  }
  return value;
}

export function normalizeProfile(
  userId: string,
  profile: PresenceProfile,
): PresenceProfile {
  validateUserId(userId);
  if (
    typeof profile.displayName !== "string" ||
    profile.displayName.trim().length === 0 ||
    profile.displayName.length > MAX_DISPLAY_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(profile.displayName)
  ) {
    throw new RealtimeError(
      "INVALID_MESSAGE",
      "displayName must be a non-empty safe string",
    );
  }
  if (profile.avatarUrl !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(profile.avatarUrl);
    } catch (error) {
      throw new RealtimeError("INVALID_MESSAGE", "avatarUrl is invalid", {
        cause: error,
      });
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new RealtimeError(
        "INVALID_MESSAGE",
        "avatarUrl must be an HTTPS URL without credentials",
      );
    }
  }
  return {
    displayName: profile.displayName.trim(),
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
  };
}
