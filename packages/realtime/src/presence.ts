import {
  createRealtimeClient,
  type RealtimeEnvelope,
  type RealtimeOptions,
  type RealtimeSnapshot,
  type RealtimeState,
  RealtimeError,
} from "./index.js";

export const PRESENCE_PROTOCOL_VERSION = 1 as const;

export type PresenceAppState = "active" | "background";

export type PresenceKind = "typing" | "recording";

export interface PresenceEvent {
  conversationId: string;
  userId: string;
  kind: PresenceKind;
  active: boolean;
  expiresAt?: number;
}

export interface PresenceLifecycleSource {
  subscribe(listener: (state: PresenceAppState) => void): () => void;
}

export interface PresenceSnapshot {
  appState: PresenceAppState;
  typingConversations: number;
  recordingConversations: number;
  realtime: RealtimeSnapshot;
}

export interface PresenceProfile {
  displayName: string;
  avatarUrl?: string;
}

export interface PresenceActivityNotification {
  id: string;
  conversationId: string;
  userId: string;
  kind: PresenceKind;
  profile?: PresenceProfile;
  title: string;
  body: string;
  createdAt: number;
}

export interface PresenceActivityNotificationOptions {
  /** Do not notify for the signed-in user, even if the server echoes events. */
  selfUserId?: string;
  /** Return false for the conversation currently visible on screen. */
  shouldNotify?: (event: PresenceEvent) => boolean;
  onNotification: (notification: PresenceActivityNotification) => void;
  now?: () => number;
  dedupeMs?: number;
  windowMs?: number;
  maxPerWindow?: number;
}

export interface PresenceProfileUpdate {
  userId: string;
  profile: PresenceProfile;
}

export interface PresenceParticipant {
  userId: string;
  profile?: PresenceProfile;
  expiresAt: number;
}

export interface PresenceConversationSnapshot {
  conversationId: string;
  typing: PresenceParticipant[];
  recording: PresenceParticipant[];
}

export interface PresenceStateStoreOptions {
  now?: () => number;
  defaultTtlMs?: number;
  maxTtlMs?: number;
  maxParticipantsPerConversation?: number;
}

export interface PresenceOptions extends Omit<
  RealtimeOptions,
  "onMessage" | "onReady" | "onStateChange"
> {
  onEvent?: (event: PresenceEvent) => void;
  onProfileChange?: (update: PresenceProfileUpdate) => void;
  onConversationChange?: (snapshot: PresenceConversationSnapshot) => void;
  onError?: (error: RealtimeError) => void;
  onStateChange?: (state: RealtimeState) => void;
  typingIdleMs?: number;
  heartbeatMs?: number;
  maxActiveConversations?: number;
  closeOnBackground?: boolean;
  stateStore?: PresenceStateStore;
  activityNotifications?: PresenceActivityNotificationOptions;
}

type PresencePayload = {
  conversationId: string;
  kind: PresenceKind;
  active: boolean;
};

const DEFAULT_TYPING_IDLE_MS = 2_500;
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_ACTIVE_CONVERSATIONS = 64;
const MAX_CONVERSATION_ID_LENGTH = 256;
const MAX_USER_ID_LENGTH = 256;
const DEFAULT_PRESENCE_TTL_MS = 10_000;
const DEFAULT_MAX_PRESENCE_TTL_MS = 60_000;
const DEFAULT_MAX_PARTICIPANTS_PER_CONVERSATION = 256;
const MAX_DISPLAY_NAME_LENGTH = 120;
const DEFAULT_ACTIVITY_DEDUPE_MS = 5_000;
const DEFAULT_ACTIVITY_WINDOW_MS = 30_000;
const DEFAULT_ACTIVITY_MAX_PER_WINDOW = 20;

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RealtimeError(
      "INVALID_CONFIGURATION",
      `${name} must be a positive integer`,
    );
  }
  return value;
}

function validateConversationId(value: string): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePresenceEvent(value: unknown): PresenceEvent | null {
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

type ActivePresence = {
  kind: PresenceKind;
  expiresAt: number;
};

function validateUserId(value: string): string {
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

function normalizeProfile(
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
export class PresenceActivityNotifier {
  private readonly options: Required<
    Pick<
      PresenceActivityNotificationOptions,
      "dedupeMs" | "windowMs" | "maxPerWindow"
    >
  > &
    PresenceActivityNotificationOptions;

  private readonly recent = new Map<string, number>();

  private readonly timestamps: number[] = [];

  private readonly now: () => number;

  constructor(options: PresenceActivityNotificationOptions) {
    this.options = {
      ...options,
      dedupeMs: assertPositiveInteger(
        options.dedupeMs ?? DEFAULT_ACTIVITY_DEDUPE_MS,
        "dedupeMs",
      ),
      windowMs: assertPositiveInteger(
        options.windowMs ?? DEFAULT_ACTIVITY_WINDOW_MS,
        "windowMs",
      ),
      maxPerWindow: assertPositiveInteger(
        options.maxPerWindow ?? DEFAULT_ACTIVITY_MAX_PER_WINDOW,
        "maxPerWindow",
      ),
    };
    this.now = options.now ?? Date.now;
  }

  notify(event: PresenceEvent, profile?: PresenceProfile): boolean {
    if (!event.active || event.userId === this.options.selfUserId) return false;
    if (this.options.shouldNotify && !this.options.shouldNotify(event))
      return false;
    const now = Math.floor(this.now());
    for (const [key, expiresAt] of this.recent)
      if (expiresAt <= now) this.recent.delete(key);
    while (
      this.timestamps[0] !== undefined &&
      this.timestamps[0] <= now - this.options.windowMs
    )
      this.timestamps.shift();
    const key = `${event.conversationId}\u0000${event.userId}\u0000${event.kind}`;
    if (
      this.recent.has(key) ||
      this.timestamps.length >= this.options.maxPerWindow
    )
      return false;
    this.recent.set(key, now + this.options.dedupeMs);
    this.timestamps.push(now);
    const displayName = profile?.displayName || event.userId;
    const action =
      event.kind === "typing" ? "is typing" : "is recording a voice message";
    this.options.onNotification({
      id: `${key}\u0000${now}`,
      conversationId: event.conversationId,
      userId: event.userId,
      kind: event.kind,
      ...(profile ? { profile: { ...profile } } : {}),
      title: displayName,
      body: action,
      createdAt: now,
    });
    return true;
  }
}

export class PresenceClient {
  private readonly options: Required<
    Pick<
      PresenceOptions,
      | "typingIdleMs"
      | "heartbeatMs"
      | "maxActiveConversations"
      | "closeOnBackground"
    >
  > &
    PresenceOptions;

  private readonly realtime;

  private readonly typing = new Set<string>();

  private readonly recording = new Set<string>();

  private readonly typingTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  private appState: PresenceAppState = "active";

  private lifecycleUnsubscribe: (() => void) | null = null;

  private readonly stateStore: PresenceStateStore;

  private readonly activityNotifier?: PresenceActivityNotifier;

  constructor(options: PresenceOptions) {
    this.options = {
      ...options,
      stateStore: options.stateStore,
      typingIdleMs: assertPositiveInteger(
        options.typingIdleMs ?? DEFAULT_TYPING_IDLE_MS,
        "typingIdleMs",
      ),
      heartbeatMs: assertPositiveInteger(
        options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
        "heartbeatMs",
      ),
      maxActiveConversations: assertPositiveInteger(
        options.maxActiveConversations ?? DEFAULT_MAX_ACTIVE_CONVERSATIONS,
        "maxActiveConversations",
      ),
      closeOnBackground: options.closeOnBackground ?? true,
    };
    this.stateStore =
      options.stateStore ?? new PresenceStateStore({ now: options.now });
    this.activityNotifier = options.activityNotifications
      ? new PresenceActivityNotifier(options.activityNotifications)
      : undefined;
    this.realtime = createRealtimeClient({
      ...options,
      onReady: () => {
        this.flushActiveStates();
        this.startHeartbeat();
      },
      onMessage: (message) => {
        this.handleMessage(message);
      },
      onStateChange: (state) => {
        if (state !== "open") this.stopHeartbeat();
        this.options.onStateChange?.(state);
      },
    });
  }

  async connect(): Promise<void> {
    if (this.appState === "background") return;
    await this.realtime.connect();
  }

  close(code = 1000, reason = "Presence client closed"): void {
    this.stopAllLocalStates();
    this.lifecycleUnsubscribe?.();
    this.lifecycleUnsubscribe = null;
    this.realtime.close(code, reason);
  }

  getSnapshot(): PresenceSnapshot {
    return {
      appState: this.appState,
      typingConversations: this.typing.size,
      recordingConversations: this.recording.size,
      realtime: this.realtime.getSnapshot(),
    };
  }

  getConversation(conversationId: string): PresenceConversationSnapshot {
    return this.stateStore.getConversation(conversationId);
  }

  setProfile(userId: string, profile: PresenceProfile): void {
    this.stateStore.setProfile(userId, profile);
  }

  getProfile(userId: string): PresenceProfile | undefined {
    return this.stateStore.getProfile(userId);
  }

  removeProfile(userId: string): void {
    this.stateStore.removeProfile(userId);
  }

  prunePresence(): string[] {
    const changed = this.stateStore.prune();
    for (const conversationId of changed)
      this.options.onConversationChange?.(
        this.stateStore.getConversation(conversationId),
      );
    return changed;
  }

  bindLifecycle(source: PresenceLifecycleSource): () => void {
    this.lifecycleUnsubscribe?.();
    const unsubscribe = source.subscribe((state) => {
      void this.setAppState(state);
    });
    this.lifecycleUnsubscribe = () => {
      unsubscribe();
      this.lifecycleUnsubscribe = null;
    };
    return this.lifecycleUnsubscribe;
  }

  async setAppState(state: PresenceAppState): Promise<void> {
    if (this.appState === state) return;
    this.appState = state;
    if (state === "background") {
      this.stopAllLocalStates();
      this.stopHeartbeat();
      if (this.options.closeOnBackground)
        this.realtime.close(1000, "App backgrounded");
      return;
    }
    if (this.isReady()) {
      this.flushActiveStates();
      this.startHeartbeat();
    } else {
      await this.realtime.connect();
    }
  }

  noteTyping(conversationId: string): void {
    const id = validateConversationId(conversationId);
    this.setTyping(id, true);
    const previous = this.typingTimers.get(id);
    if (previous) clearTimeout(previous);
    this.typingTimers.set(
      id,
      setTimeout(() => {
        this.typingTimers.delete(id);
        this.setTyping(id, false);
      }, this.options.typingIdleMs),
    );
  }

  startTyping(conversationId: string): void {
    const id = validateConversationId(conversationId);
    this.clearTypingTimer(id);
    this.setTyping(id, true);
  }

  stopTyping(conversationId: string): void {
    const id = validateConversationId(conversationId);
    this.clearTypingTimer(id);
    this.setTyping(id, false);
  }

  startRecording(conversationId: string): void {
    this.setRecording(validateConversationId(conversationId), true);
  }

  stopRecording(conversationId: string): void {
    this.setRecording(validateConversationId(conversationId), false);
  }

  private setTyping(conversationId: string, active: boolean): void {
    if (this.appState === "background") return;
    const hadState = this.typing.has(conversationId);
    if (hadState === active) return;
    if (active) this.ensureCapacity("typing", conversationId);
    if (active) this.typing.add(conversationId);
    else this.typing.delete(conversationId);
    this.sendState("typing", conversationId, active);
  }

  private setRecording(conversationId: string, active: boolean): void {
    if (this.appState === "background") return;
    const hadState = this.recording.has(conversationId);
    if (hadState === active) return;
    if (active) this.ensureCapacity("recording", conversationId);
    if (active) this.recording.add(conversationId);
    else this.recording.delete(conversationId);
    this.sendState("recording", conversationId, active);
  }

  private ensureCapacity(kind: PresenceKind, conversationId: string): void {
    const count = this.typing.size + this.recording.size;
    const alreadyActive =
      kind === "typing"
        ? this.typing.has(conversationId)
        : this.recording.has(conversationId);
    if (!alreadyActive && count >= this.options.maxActiveConversations) {
      throw new RealtimeError(
        "QUEUE_FULL",
        "Maximum active presence conversations reached",
      );
    }
  }

  private sendState(
    kind: PresenceKind,
    conversationId: string,
    active: boolean,
  ): void {
    if (!this.isReady()) return;
    try {
      this.realtime.send(`presence.${kind}`, {
        conversationId,
        kind,
        active,
      });
    } catch (error) {
      this.options.onError?.(
        error instanceof RealtimeError
          ? error
          : new RealtimeError(
              "SOCKET_ERROR",
              "Presence state could not be sent",
              { cause: error },
            ),
      );
    }
  }

  private flushActiveStates(): void {
    if (!this.isReady() || this.appState === "background") return;
    for (const conversationId of this.typing)
      this.sendState("typing", conversationId, true);
    for (const conversationId of this.recording)
      this.sendState("recording", conversationId, true);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const tick = (): void => {
      if (this.isReady() && this.appState === "active") {
        const active: PresencePayload[] = [
          ...[...this.typing].map((conversationId) => ({
            conversationId,
            kind: "typing" as const,
            active: true,
          })),
          ...[...this.recording].map((conversationId) => ({
            conversationId,
            kind: "recording" as const,
            active: true,
          })),
        ];
        if (active.length > 0) {
          try {
            this.realtime.send("presence.refresh", active);
          } catch (error) {
            this.options.onError?.(
              error instanceof RealtimeError
                ? error
                : new RealtimeError(
                    "SOCKET_ERROR",
                    "Presence refresh could not be sent",
                    { cause: error },
                  ),
            );
          }
        }
      }
      this.heartbeatTimer = setTimeout(tick, this.options.heartbeatMs);
    };
    this.heartbeatTimer = setTimeout(tick, this.options.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private stopAllLocalStates(): void {
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
    for (const conversationId of this.typing)
      this.sendState("typing", conversationId, false);
    for (const conversationId of this.recording)
      this.sendState("recording", conversationId, false);
    this.typing.clear();
    this.recording.clear();
  }

  private clearTypingTimer(conversationId: string): void {
    const timer = this.typingTimers.get(conversationId);
    if (timer) clearTimeout(timer);
    this.typingTimers.delete(conversationId);
  }

  private isReady(): boolean {
    const snapshot = this.realtime.getSnapshot();
    return snapshot.state === "open" && snapshot.authenticated;
  }

  private handleMessage(message: RealtimeEnvelope): void {
    if (message.type === "profile.updated") {
      if (!isRecord(message.payload)) return;
      const userId = message.payload.userId;
      const profile = message.payload.profile;
      if (typeof userId !== "string" || !isRecord(profile)) return;
      try {
        this.stateStore.setProfile(
          userId,
          profile as unknown as PresenceProfile,
        );
      } catch {
        return;
      }
      const update = {
        userId,
        profile: this.stateStore.getProfile(userId),
      };
      if (!update.profile) return;
      this.options.onProfileChange?.(update as PresenceProfileUpdate);
      for (const conversationId of this.stateStore.getActiveConversationIds())
        this.options.onConversationChange?.(
          this.stateStore.getConversation(conversationId),
        );
      return;
    }
    if (message.type !== "presence.changed") return;
    const event = parsePresenceEvent(message.payload);
    if (!event || !this.stateStore.apply(event)) return;
    this.options.onEvent?.(event);
    this.options.onConversationChange?.(
      this.stateStore.getConversation(event.conversationId),
    );
    this.activityNotifier?.notify(
      event,
      this.stateStore.getProfile(event.userId),
    );
  }
}

export function createPresenceClient(options: PresenceOptions): PresenceClient {
  return new PresenceClient(options);
}
