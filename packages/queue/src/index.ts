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

  async enqueue<T>(queue: string, payload: T): Promise<void> {
    assert(this.client.isReady, "QUEUE_NOT_READY", "Redis queue is not ready");
    await this.client.rPush(`${this.prefix}:${queue}`, JSON.stringify(payload));
  }

  async size(queue: string): Promise<number> {
    assert(this.client.isReady, "QUEUE_NOT_READY", "Redis queue is not ready");
    return this.client.lLen(`${this.prefix}:${queue}`);
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}
