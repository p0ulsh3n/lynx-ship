import {
  createRealtimeClient,
  RealtimeError,
  type JsonValue,
  type RealtimeClient,
  type RealtimeEnvelope,
  type RealtimeOptions,
  type RealtimeState,
} from "./index.js";

export const RECEIPT_PROTOCOL_VERSION = 1 as const;

export type ReadReceiptKind = "delivered" | "read";

export interface ReadReceiptEvent {
  conversationId: string;
  messageId: string;
  userId: string;
  kind: ReadReceiptKind;
  occurredAt: number;
}

export interface ReadReceiptMessageSnapshot {
  conversationId: string;
  messageId: string;
  deliveredBy: string[];
  readBy: string[];
}

export interface ReadReceiptStoreOptions {
  now?: () => number;
  maxMessagesPerConversation?: number;
  maxReadersPerMessage?: number;
  maxAgeMs?: number;
}

export interface ReadReceiptStore {
  apply(event: ReadReceiptEvent): boolean;
  getMessage(
    conversationId: string,
    messageId: string,
  ): ReadReceiptMessageSnapshot;
  getConversation(conversationId: string): ReadReceiptMessageSnapshot[];
  prune(now?: number): string[];
}

export interface ReadReceiptOptions extends Omit<
  RealtimeOptions,
  "onMessage" | "onReady" | "onStateChange"
> {
  /** Supply an existing client when the app already owns the realtime session. */
  realtime?: RealtimeClient;
  onReceipt?: (event: ReadReceiptEvent) => void;
  onStateChange?: (state: RealtimeState) => void;
  store?: ReadReceiptStore;
  maxMessagesPerConversation?: number;
  maxReadersPerMessage?: number;
  maxReceiptAgeMs?: number;
}

type LocalReceipt = {
  kind: ReadReceiptKind;
  occurredAt: number;
};

const MAX_ID_LENGTH = 256;
const DEFAULT_MAX_MESSAGES = 2_000;
const DEFAULT_MAX_READERS = 512;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

function validateId(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new RealtimeError("INVALID_MESSAGE", `${name} is invalid`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RealtimeError("INVALID_CONFIGURATION", `${name} is invalid`);
  return value;
}

function parseReceipt(value: unknown): ReadReceiptEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.conversationId !== "string" ||
    typeof candidate.messageId !== "string" ||
    typeof candidate.userId !== "string" ||
    (candidate.kind !== "delivered" && candidate.kind !== "read") ||
    typeof candidate.occurredAt !== "number" ||
    !Number.isSafeInteger(candidate.occurredAt)
  )
    return null;
  try {
    return {
      conversationId: validateId(candidate.conversationId, "conversationId"),
      messageId: validateId(candidate.messageId, "messageId"),
      userId: validateId(candidate.userId, "userId"),
      kind: candidate.kind,
      occurredAt: candidate.occurredAt,
    };
  } catch {
    return null;
  }
}

export class InMemoryReadReceiptStore implements ReadReceiptStore {
  private readonly now: () => number;

  private readonly maxMessagesPerConversation: number;

  private readonly maxReadersPerMessage: number;

  private readonly maxAgeMs: number;

  private readonly conversations = new Map<
    string,
    Map<string, Map<string, LocalReceipt>>
  >();

  constructor(options: ReadReceiptStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxMessagesPerConversation = positiveInteger(
      options.maxMessagesPerConversation ?? DEFAULT_MAX_MESSAGES,
      "maxMessagesPerConversation",
    );
    this.maxReadersPerMessage = positiveInteger(
      options.maxReadersPerMessage ?? DEFAULT_MAX_READERS,
      "maxReadersPerMessage",
    );
    this.maxAgeMs = positiveInteger(
      options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      "maxAgeMs",
    );
  }

  apply(event: ReadReceiptEvent): boolean {
    const parsed = parseReceipt(event);
    if (!parsed) return false;
    const now = Math.floor(this.now());
    if (parsed.occurredAt < now - this.maxAgeMs) return false;

    let messages = this.conversations.get(parsed.conversationId);
    if (!messages) {
      messages = new Map();
      this.conversations.set(parsed.conversationId, messages);
    }
    let readers = messages.get(parsed.messageId);
    if (!readers) {
      if (messages.size >= this.maxMessagesPerConversation) return false;
      readers = new Map();
      messages.set(parsed.messageId, readers);
    }
    const previous = readers.get(parsed.userId);
    if (
      previous &&
      (previous.kind === "read" || parsed.kind === previous.kind) &&
      previous.occurredAt >= parsed.occurredAt
    )
      return false;
    if (!previous && readers.size >= this.maxReadersPerMessage) return false;
    readers.set(parsed.userId, {
      kind: parsed.kind,
      occurredAt: parsed.occurredAt,
    });
    return true;
  }

  getMessage(
    conversationId: string,
    messageId: string,
  ): ReadReceiptMessageSnapshot {
    const conversation = validateId(conversationId, "conversationId");
    const message = validateId(messageId, "messageId");
    const readers = this.conversations.get(conversation)?.get(message);
    const deliveredBy: string[] = [];
    const readBy: string[] = [];
    for (const [userId, receipt] of readers ?? []) {
      deliveredBy.push(userId);
      if (receipt.kind === "read") readBy.push(userId);
    }
    deliveredBy.sort();
    readBy.sort();
    return {
      conversationId: conversation,
      messageId: message,
      deliveredBy,
      readBy,
    };
  }

  getConversation(conversationId: string): ReadReceiptMessageSnapshot[] {
    const conversation = validateId(conversationId, "conversationId");
    return [...(this.conversations.get(conversation)?.keys() ?? [])]
      .sort()
      .map((messageId) => this.getMessage(conversation, messageId));
  }

  prune(now = Math.floor(this.now())): string[] {
    const changed = new Set<string>();
    for (const [conversationId, messages] of this.conversations) {
      let conversationChanged = false;
      for (const [messageId, readers] of messages) {
        for (const [userId, receipt] of readers) {
          if (receipt.occurredAt < now - this.maxAgeMs) {
            readers.delete(userId);
            conversationChanged = true;
          }
        }
        if (readers.size === 0) {
          messages.delete(messageId);
          conversationChanged = true;
        }
      }
      if (messages.size === 0) {
        this.conversations.delete(conversationId);
        conversationChanged = true;
      }
      if (conversationChanged) changed.add(conversationId);
    }
    return [...changed].sort();
  }
}

export class ReadReceiptClient {
  private readonly realtime: RealtimeClient;

  private readonly ownsRealtime: boolean;

  private readonly store: ReadReceiptStore;

  private readonly local = new Map<string, LocalReceipt>();

  private readonly unsubscribe: () => void;

  private readonly options: ReadReceiptOptions;

  constructor(options: ReadReceiptOptions) {
    this.options = options;
    this.store =
      options.store ??
      new InMemoryReadReceiptStore({
        now: options.now,
        maxMessagesPerConversation: options.maxMessagesPerConversation,
        maxReadersPerMessage: options.maxReadersPerMessage,
        maxAgeMs: options.maxReceiptAgeMs,
      });
    if (options.realtime) {
      this.realtime = options.realtime;
      this.ownsRealtime = false;
    } else {
      this.realtime = createRealtimeClient({
        ...options,
        onMessage: undefined,
        onReady: () => this.flushLocalReceipts(),
        onStateChange: options.onStateChange,
      });
      this.ownsRealtime = true;
    }
    this.unsubscribe = this.realtime.subscribe((message) =>
      this.handleMessage(message),
    );
  }

  async connect(): Promise<void> {
    await this.realtime.connect();
  }

  close(code = 1000, reason = "Read receipt client closed"): void {
    this.unsubscribe();
    if (this.ownsRealtime) this.realtime.close(code, reason);
  }

  getMessage(
    conversationId: string,
    messageId: string,
  ): ReadReceiptMessageSnapshot {
    return this.store.getMessage(conversationId, messageId);
  }

  getConversation(conversationId: string): ReadReceiptMessageSnapshot[] {
    return this.store.getConversation(conversationId);
  }

  prune(): string[] {
    return this.store.prune();
  }

  markDelivered(conversationId: string, messageId: string): string {
    return this.mark(conversationId, messageId, "delivered");
  }

  markRead(conversationId: string, messageId: string): string {
    return this.mark(conversationId, messageId, "read");
  }

  private mark(
    conversationId: string,
    messageId: string,
    kind: ReadReceiptKind,
  ): string {
    const conversation = validateId(conversationId, "conversationId");
    const message = validateId(messageId, "messageId");
    const key = `${conversation}\u0000${message}`;
    const occurredAt = Math.floor((this.options.now ?? Date.now)());
    const previous = this.local.get(key);
    if (previous?.kind === "read" || previous?.kind === kind) return "";
    this.local.set(key, { kind, occurredAt });
    return this.realtime.send(`message.${kind}`, {
      conversationId: conversation,
      messageId: message,
      occurredAt,
    } as JsonValue);
  }

  private flushLocalReceipts(): void {
    for (const [key, receipt] of this.local) {
      const separator = key.indexOf("\u0000");
      if (separator < 1) continue;
      try {
        this.realtime.send(`message.${receipt.kind}`, {
          conversationId: key.slice(0, separator),
          messageId: key.slice(separator + 1),
          occurredAt: receipt.occurredAt,
        });
      } catch {
        // The realtime client reports transport failures through its callback.
      }
    }
  }

  private handleMessage(message: RealtimeEnvelope): void {
    if (message.type !== "message.receipt.changed") return;
    const event = parseReceipt(message.payload);
    if (!event || !this.store.apply(event)) return;
    this.options.onReceipt?.(event);
  }
}

export function createReadReceiptClient(
  options: ReadReceiptOptions,
): ReadReceiptClient {
  return new ReadReceiptClient(options);
}
