import type { PresenceActivityNotification } from "./presence.js";

export interface ActivityStackItem {
  id: string;
  conversationId: string;
  createdAt: number;
}

export interface ActivityStackOptions<
  T extends ActivityStackItem = PresenceActivityNotification,
> {
  /** Clock used for expiry and deterministic tests. */
  now?: () => number;
  /** Number of cards the renderer should show at once. */
  maxVisible?: number;
  /** Number of recent items retained for overflow and dismissal. */
  maxItems?: number;
  /** How long an item remains visible before it expires. */
  ttlMs?: number;
  /** Vertical overlap between successive cards, in logical pixels. */
  overlapPx?: number;
  /** Scale reduction applied to each card behind the newest card. */
  scaleStep?: number;
  /** Opacity reduction applied to each card behind the newest card. */
  opacityStep?: number;
  /** Override identity when repeated items should replace one another. */
  keyOf?: (item: T) => string;
  onChange?: (snapshot: ActivityStackSnapshot<T>) => void;
}

export interface ActivityStackEntry<T extends ActivityStackItem> {
  key: string;
  item: T;
  index: number;
  offsetY: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

export interface ActivityStackSnapshot<T extends ActivityStackItem> {
  visible: ActivityStackEntry<T>[];
  overflowCount: number;
  totalCount: number;
}

const DEFAULT_MAX_VISIBLE = 3;
const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_TTL_MS = 6_000;
const DEFAULT_OVERLAP_PX = 10;
const DEFAULT_SCALE_STEP = 0.035;
const DEFAULT_OPACITY_STEP = 0.14;

type Timer = ReturnType<typeof setTimeout>;

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name} must be a finite non-negative number`);
  return value;
}

function boundedFraction(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error(
      `${name} must be greater than or equal to 0 and less than 1`,
    );
  return value;
}

function activityKey(item: PresenceActivityNotification): string {
  return `${item.conversationId}\u0000${item.userId}\u0000${item.kind}`;
}

/** Headless layout/state model for a bounded, top-stacked banner surface. */
export class ActivityStack<T extends ActivityStackItem> {
  private readonly now: () => number;

  private readonly maxVisible: number;

  private readonly maxItems: number;

  private readonly ttlMs: number;

  private readonly overlapPx: number;

  private readonly scaleStep: number;

  private readonly opacityStep: number;

  private readonly keyOf: (item: T) => string;

  private readonly onChange?: (snapshot: ActivityStackSnapshot<T>) => void;

  private readonly items = new Map<string, T>();

  private readonly timers = new Map<string, Timer>();

  constructor(options: ActivityStackOptions<T> = {}) {
    this.now = options.now ?? Date.now;
    this.maxVisible = positiveInteger(
      options.maxVisible ?? DEFAULT_MAX_VISIBLE,
      "maxVisible",
    );
    this.maxItems = positiveInteger(
      options.maxItems ?? DEFAULT_MAX_ITEMS,
      "maxItems",
    );
    if (this.maxItems < this.maxVisible)
      throw new Error("maxItems must be greater than or equal to maxVisible");
    this.ttlMs = positiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, "ttlMs");
    this.overlapPx = nonNegativeNumber(
      options.overlapPx ?? DEFAULT_OVERLAP_PX,
      "overlapPx",
    );
    this.scaleStep = boundedFraction(
      options.scaleStep ?? DEFAULT_SCALE_STEP,
      "scaleStep",
    );
    this.opacityStep = boundedFraction(
      options.opacityStep ?? DEFAULT_OPACITY_STEP,
      "opacityStep",
    );
    this.keyOf = options.keyOf ?? ((item) => item.id);
    this.onChange = options.onChange;
  }

  push(item: T): ActivityStackSnapshot<T> {
    const key = this.keyOf(item);
    if (!key) throw new Error("activity stack keys must not be empty");
    this.items.delete(key);
    this.clearTimer(key);
    this.items.set(key, item);
    while (this.items.size > this.maxItems) {
      const oldest = this.items.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.items.delete(oldest);
      this.clearTimer(oldest);
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.items.delete(key);
        this.timers.delete(key);
        this.emit();
      }, this.ttlMs),
    );
    return this.emit();
  }

  dismiss(key: string): ActivityStackSnapshot<T> {
    this.items.delete(key);
    this.clearTimer(key);
    return this.emit();
  }

  clear(): ActivityStackSnapshot<T> {
    this.items.clear();
    for (const key of [...this.timers.keys()]) this.clearTimer(key);
    return this.emit();
  }

  getSnapshot(): ActivityStackSnapshot<T> {
    const now = this.now();
    for (const [key, item] of [...this.items]) {
      if (now - item.createdAt >= this.ttlMs) {
        this.items.delete(key);
        this.clearTimer(key);
      }
    }
    const newestFirst = [...this.items.entries()].sort(
      (left, right) => right[1].createdAt - left[1].createdAt,
    );
    const visible = newestFirst
      .slice(0, this.maxVisible)
      .map(([key, item], index) => ({
        key,
        item,
        index,
        offsetY: index * this.overlapPx,
        scale: Math.max(0, 1 - index * this.scaleStep),
        opacity: Math.max(0, 1 - index * this.opacityStep),
        zIndex: this.maxVisible - index,
      }));
    return {
      visible,
      overflowCount: Math.max(0, newestFirst.length - visible.length),
      totalCount: newestFirst.length,
    };
  }

  destroy(): void {
    this.items.clear();
    for (const key of [...this.timers.keys()]) this.clearTimer(key);
  }

  private emit(): ActivityStackSnapshot<T> {
    const snapshot = this.getSnapshot();
    this.onChange?.(snapshot);
    return snapshot;
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }
}

/**
 * Presence specialization: one current card per conversation, participant and
 * activity kind. Use ActivityStack directly for messages or custom banners.
 */
export class PresenceActivityStack extends ActivityStack<PresenceActivityNotification> {
  constructor(
    options: ActivityStackOptions<PresenceActivityNotification> = {},
  ) {
    super({ ...options, keyOf: options.keyOf ?? activityKey });
  }
}
