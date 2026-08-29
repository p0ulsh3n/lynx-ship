import { createHash } from "node:crypto";
import {
  MAX_FANOUT,
  NotificationError,
  utf8Bytes,
  validateIdentifier,
  validateImageUrl,
  validateNotificationText,
  type Clock,
  type NotificationKind,
} from "./core.js";
import type { SendToUserInput, SendToUserResult } from "./service.js";

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
