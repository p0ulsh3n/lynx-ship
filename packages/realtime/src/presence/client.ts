import {
  createRealtimeClient,
  RealtimeError,
  type RealtimeEnvelope,
} from "../client.js";
import type {
  PresenceAppState,
  PresenceConversationSnapshot,
  PresenceKind,
  PresenceLifecycleSource,
  PresenceOptions,
  PresenceProfile,
  PresenceProfileUpdate,
  PresenceSnapshot,
} from "./models.js";
import {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_MAX_ACTIVE_CONVERSATIONS,
  DEFAULT_TYPING_IDLE_MS,
  PresencePayload,
  assertPositiveInteger,
  isRecord,
  parsePresenceEvent,
  validateConversationId,
} from "./core.js";
import { PresenceActivityNotifier } from "./notifier.js";
import { PresenceStateStore } from "./state-store.js";

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
