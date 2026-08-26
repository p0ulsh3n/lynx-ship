import { createId, assert } from "@lynxship/contracts";
import { createClient } from "redis";

export interface QueueItem<T> {
  id: string;
  payload: T;
  status: "queued" | "leased" | "completed" | "retry" | "dead";
  availableAt: number;
  maxAttempts: number;
  attempts: number;
  lease: { workerId: string; expiresAt: number } | null;
}

export interface RedisQueueMessage<T> {
  id: string;
  payload: T;
}

export interface RedisConsumeOptions {
  count?: number;
  blockMs?: number;
}

export class LeaseQueue<T = unknown> {
  readonly jobs: QueueItem<T>[] = [];

  enqueue(
    payload: T,
    options: { availableAt?: number; maxAttempts?: number } = {},
  ) {
    const item: QueueItem<T> = {
      id: createId("q"),
      payload,
      status: "queued",
      availableAt: options.availableAt ?? Date.now(),
      maxAttempts: options.maxAttempts ?? 3,
      attempts: 0,
      lease: null,
    };
    this.jobs.push(item);
    return item;
  }

  lease(workerId: string, now = Date.now()) {
    const item = this.jobs.find(
      (candidate) =>
        candidate.status === "queued" && candidate.availableAt <= now,
    );
    if (!item) return null;
    item.status = "leased";
    item.attempts += 1;
    item.lease = { workerId, expiresAt: now + 30_000 };
    return item;
  }

  ack(id: string, workerId: string) {
    const item = this.get(id);
    assert(
      item.status === "leased" && item.lease?.workerId === workerId,
      "QUEUE_LEASE",
      "Queue item is not leased by this worker",
    );
    item.status = "completed";
    item.lease = null;
    return item;
  }

  fail(id: string, workerId: string, now = Date.now()) {
    const item = this.get(id);
    assert(
      item.status === "leased" && item.lease?.workerId === workerId,
      "QUEUE_LEASE",
      "Queue item is not leased by this worker",
    );
    item.lease = null;
    if (item.attempts >= item.maxAttempts) item.status = "dead";
    else {
      item.status = "retry";
      item.availableAt = now + 2 ** item.attempts * 1000;
    }
    return item;
  }

  recoverExpired(now = Date.now()) {
    for (const item of this.jobs)
      if (
        item.status === "leased" &&
        item.lease &&
        item.lease.expiresAt <= now
      ) {
        item.status = item.attempts >= item.maxAttempts ? "dead" : "queued";
        item.lease = null;
      }
    return this.jobs;
  }

  get(id: string) {
    const item = this.jobs.find((candidate) => candidate.id === id);
    assert(item, "QUEUE_NOT_FOUND", "Queue item not found");
    return item;
  }

  list() {
    return [...this.jobs];
  }
}

export class RedisQueue {
  readonly driver = "redis" as const;

  private readonly client: ReturnType<typeof createClient>;

  constructor(
    readonly url: string,
    readonly prefix = "lynxship",
    readonly group = "workers",
  ) {
    this.client = createClient({ url });
    this.client.on("error", (error) => {
      console.error("Redis queue error", error);
    });
  }

  async initialize(): Promise<void> {
    if (!this.client.isOpen) await this.client.connect();
    await this.client.ping();
  }

  private streamKey(queue: string): string {
    assert(
      /^[a-zA-Z0-9._:-]+$/.test(queue),
      "QUEUE_NAME",
      "Queue name contains unsupported characters",
    );
    return `${this.prefix}:${queue}:stream`;
  }

  private async ensureGroup(queue: string): Promise<string> {
    assert(this.client.isReady, "QUEUE_NOT_READY", "Redis queue is not ready");
    const key = this.streamKey(queue);
    try {
      await this.client.sendCommand([
        "XGROUP",
        "CREATE",
        key,
        this.group,
        "0-0",
        "MKSTREAM",
      ]);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP"))
        throw error;
    }
    return key;
  }

  async enqueue<T>(queue: string, payload: T): Promise<string> {
    const key = this.streamKey(queue);
    assert(this.client.isReady, "QUEUE_NOT_READY", "Redis queue is not ready");
    return this.client.sendCommand([
      "XADD",
      key,
      "*",
      "payload",
      JSON.stringify(payload),
    ]);
  }

  async size(queue: string): Promise<number> {
    assert(this.client.isReady, "QUEUE_NOT_READY", "Redis queue is not ready");
    return this.client.xLen(this.streamKey(queue));
  }

  async consume<T>(
    queue: string,
    consumer: string,
    options: RedisConsumeOptions = {},
  ): Promise<RedisQueueMessage<T>[]> {
    const key = await this.ensureGroup(queue);
    assert(
      /^[a-zA-Z0-9._:-]+$/.test(consumer),
      "QUEUE_CONSUMER",
      "Consumer name contains unsupported characters",
    );
    const count = String(options.count ?? 1);
    const blockMs = String(options.blockMs ?? 5000);
    const response = (await this.client.sendCommand([
      "XREADGROUP",
      "GROUP",
      this.group,
      consumer,
      "COUNT",
      count,
      "BLOCK",
      blockMs,
      "STREAMS",
      key,
      ">",
    ])) as unknown;
    return parseStreamMessages<T>(response);
  }

  async reclaim<T>(
    queue: string,
    consumer: string,
    minIdleMs = 30_000,
    count = 10,
  ): Promise<RedisQueueMessage<T>[]> {
    const key = await this.ensureGroup(queue);
    assert(
      Number.isInteger(minIdleMs) && minIdleMs >= 0,
      "QUEUE_IDLE_TIME",
      "Minimum idle time must be a non-negative integer",
    );
    const response = (await this.client.sendCommand([
      "XAUTOCLAIM",
      key,
      this.group,
      consumer,
      String(minIdleMs),
      "0-0",
      "COUNT",
      String(count),
    ])) as unknown;
    return parseAutoClaimMessages<T>(response);
  }

  async ack(queue: string, id: string): Promise<void> {
    assert(this.client.isReady, "QUEUE_NOT_READY", "Redis queue is not ready");
    await this.client.sendCommand([
      "EVAL",
      "local acked = redis.call('XACK', KEYS[1], ARGV[1], ARGV[2]); if acked == 1 then return redis.call('XDEL', KEYS[1], ARGV[2]); end; return 0",
      "1",
      this.streamKey(queue),
      this.group,
      id,
    ]);
  }

  async pending(queue: string): Promise<number> {
    assert(this.client.isReady, "QUEUE_NOT_READY", "Redis queue is not ready");
    const response = (await this.client.sendCommand([
      "XPENDING",
      this.streamKey(queue),
      this.group,
    ])) as unknown[];
    return Number(response[0] ?? 0);
  }

  async probe(): Promise<void> {
    assert(this.client.isReady, "QUEUE_NOT_READY", "Redis queue is not ready");
    await this.client.ping();
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}

function parseStreamMessages<T>(value: unknown): RedisQueueMessage<T>[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const stream = value[0];
  if (!Array.isArray(stream) || !Array.isArray(stream[1])) return [];
  return parseEntries<T>(stream[1]);
}

function parseAutoClaimMessages<T>(value: unknown): RedisQueueMessage<T>[] {
  if (!Array.isArray(value) || value.length < 2) return [];
  return parseEntries<T>(value[1]);
}

function parseEntries<T>(value: unknown[]): RedisQueueMessage<T>[] {
  const messages: RedisQueueMessage<T>[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const id = String(entry[0]);
    const fields = entry[1];
    if (!Array.isArray(fields)) continue;
    const payloadIndex = fields.findIndex(
      (field) => String(field) === "payload",
    );
    const payloadValue = fields[payloadIndex + 1];
    if (payloadIndex < 0 || typeof payloadValue !== "string") continue;
    try {
      messages.push({ id, payload: JSON.parse(payloadValue) as T });
    } catch {
      throw new Error(`Invalid JSON payload in Redis queue message ${id}`);
    }
  }
  return messages;
}
