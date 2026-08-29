import { RealtimeError } from "../client.js";
import type {
  PresenceConversationSnapshot,
  PresenceEvent,
  PresenceKind,
  PresenceParticipant,
  PresenceProfile,
  PresenceStateStoreOptions,
} from "./models.js";
import {
  DEFAULT_MAX_PARTICIPANTS_PER_CONVERSATION,
  DEFAULT_MAX_PRESENCE_TTL_MS,
  DEFAULT_PRESENCE_TTL_MS,
  ActivePresence,
  assertPositiveInteger,
  normalizeProfile,
  parsePresenceEvent,
  validateConversationId,
  validateUserId,
} from "./core.js";

export class PresenceStateStore {
  private readonly options: Required<
    Pick<
      PresenceStateStoreOptions,
      "now" | "defaultTtlMs" | "maxTtlMs" | "maxParticipantsPerConversation"
    >
  >;

  private readonly conversations = new Map<
    string,
    Map<string, Map<PresenceKind, ActivePresence>>
  >();

  private readonly profiles = new Map<string, PresenceProfile>();

  constructor(options: PresenceStateStoreOptions = {}) {
    const defaultTtlMs = assertPositiveInteger(
      options.defaultTtlMs ?? DEFAULT_PRESENCE_TTL_MS,
      "defaultTtlMs",
    );
    const maxTtlMs = assertPositiveInteger(
      options.maxTtlMs ?? DEFAULT_MAX_PRESENCE_TTL_MS,
      "maxTtlMs",
    );
    if (defaultTtlMs > maxTtlMs)
      throw new RealtimeError(
        "INVALID_CONFIGURATION",
        "defaultTtlMs must not exceed maxTtlMs",
      );
    this.options = {
      now: options.now ?? Date.now,
      defaultTtlMs,
      maxTtlMs,
      maxParticipantsPerConversation: assertPositiveInteger(
        options.maxParticipantsPerConversation ??
          DEFAULT_MAX_PARTICIPANTS_PER_CONVERSATION,
        "maxParticipantsPerConversation",
      ),
    };
  }

  apply(event: PresenceEvent): boolean {
    const parsed = parsePresenceEvent(event);
    if (!parsed) return false;
    const now = Math.floor(this.options.now());
    const users = this.conversations.get(parsed.conversationId);
    if (!parsed.active) {
      const userStates = users?.get(parsed.userId);
      const deleted = userStates?.delete(parsed.kind) ?? false;
      if (userStates?.size === 0) users?.delete(parsed.userId);
      if (users?.size === 0) this.conversations.delete(parsed.conversationId);
      return deleted;
    }
    const expiresAt = Math.min(
      parsed.expiresAt ?? now + this.options.defaultTtlMs,
      now + this.options.maxTtlMs,
    );
    if (expiresAt <= now) return false;
    let conversation = users;
    if (!conversation) {
      conversation = new Map();
      this.conversations.set(parsed.conversationId, conversation);
    }
    let userStates = conversation.get(parsed.userId);
    if (!userStates) {
      if (conversation.size >= this.options.maxParticipantsPerConversation)
        return false;
      userStates = new Map();
      conversation.set(parsed.userId, userStates);
    }
    const previous = userStates.get(parsed.kind);
    if (previous?.expiresAt === expiresAt) return false;
    userStates.set(parsed.kind, { kind: parsed.kind, expiresAt });
    return true;
  }

  setProfile(userId: string, profile: PresenceProfile): void {
    this.profiles.set(userId, normalizeProfile(userId, profile));
  }

  getProfile(userId: string): PresenceProfile | undefined {
    const profile = this.profiles.get(validateUserId(userId));
    return profile ? { ...profile } : undefined;
  }

  removeProfile(userId: string): void {
    this.profiles.delete(validateUserId(userId));
  }

  prune(now = Math.floor(this.options.now())): string[] {
    const changed = new Set<string>();
    for (const [conversationId, users] of this.conversations) {
      let conversationChanged = false;
      for (const [userId, states] of users) {
        for (const [kind, state] of states) {
          if (state.expiresAt <= now) {
            states.delete(kind);
            conversationChanged = true;
          }
        }
        if (states.size === 0) users.delete(userId);
      }
      if (conversationChanged) changed.add(conversationId);
      if (users.size === 0) {
        this.conversations.delete(conversationId);
        changed.add(conversationId);
      }
    }
    return [...changed];
  }

  getConversation(conversationId: string): PresenceConversationSnapshot {
    const id = validateConversationId(conversationId);
    this.prune();
    const users = this.conversations.get(id);
    const participants = (kind: PresenceKind): PresenceParticipant[] =>
      [...(users?.entries() ?? [])]
        .map(([userId, states]) => {
          const state = states.get(kind);
          if (!state) return null;
          const profile = this.profiles.get(userId);
          return {
            userId,
            ...(profile ? { profile: { ...profile } } : {}),
            expiresAt: state.expiresAt,
          };
        })
        .filter((value): value is PresenceParticipant => value !== null)
        .sort((left, right) => left.userId.localeCompare(right.userId));
    return {
      conversationId: id,
      typing: participants("typing"),
      recording: participants("recording"),
    };
  }

  getActiveConversationIds(): string[] {
    return [...this.conversations.keys()].sort();
  }
}

/**
 * Converts remote presence transitions into foreground UI notifications.
 * This never posts an OS notification; the host decides how to render the
 * returned activity while its process is alive.
 */
