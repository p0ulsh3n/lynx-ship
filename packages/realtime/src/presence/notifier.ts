import type {
  PresenceActivityNotificationOptions,
  PresenceEvent,
  PresenceProfile,
} from "./models.js";
import {
  DEFAULT_ACTIVITY_DEDUPE_MS,
  DEFAULT_ACTIVITY_MAX_PER_WINDOW,
  DEFAULT_ACTIVITY_WINDOW_MS,
  assertPositiveInteger,
} from "./core.js";

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
