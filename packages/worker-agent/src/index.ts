import {
  assert,
  createId,
  type Platform,
  type Worker,
} from "@lynxship/contracts";
import { RedisQueue, type RedisQueueMessage } from "@lynxship/queue";

export interface RegisterWorkerInput {
  name: string;
  organizationId: string;
  platform: Platform;
  capabilities?: Record<string, unknown>;
}

export class WorkerRegistry {
  readonly workers = new Map<string, Worker>();

  register(input: RegisterWorkerInput): Worker {
    assert(
      input.name && input.organizationId,
      "WORKER_INPUT",
      "name and organizationId are required",
    );
    const now = new Date().toISOString();
    const worker: Worker = {
      id: createId("wrk"),
      name: input.name,
      organizationId: input.organizationId,
      platform: input.platform,
      capabilities: input.capabilities ?? {},
      status: "ready",
      registeredAt: now,
      lastHeartbeatAt: now,
    };
    this.workers.set(worker.id, worker);
    return worker;
  }

  heartbeat(id: string): Worker {
    const worker = this.get(id);
    assert(worker.status !== "revoked", "WORKER_REVOKED", "Worker is revoked");
    worker.lastHeartbeatAt = new Date().toISOString();
    if (worker.status === "offline") worker.status = "ready";
    return worker;
  }

  markOffline(now = Date.now(), staleAfterMs = 90_000): Worker[] {
    const cutoff = now - staleAfterMs;
    const offline: Worker[] = [];
    for (const worker of this.workers.values()) {
      if (
        worker.status === "ready" &&
        Date.parse(worker.lastHeartbeatAt) <= cutoff
      ) {
        worker.status = "offline";
        offline.push(worker);
      }
    }
    return offline;
  }

  drain(id: string): Worker {
    const worker = this.get(id);
    assert(worker.status !== "revoked", "WORKER_REVOKED", "Worker is revoked");
    worker.status = "draining";
    return worker;
  }

  revoke(id: string): Worker {
    const worker = this.get(id);
    worker.status = "revoked";
    return worker;
  }

  get(id: string): Worker {
    const worker = this.workers.get(id);
    assert(worker, "WORKER_NOT_FOUND", "Worker not found");
    return worker;
  }

  list(organizationId?: string): Worker[] {
    return [...this.workers.values()].filter(
      (worker) => !organizationId || worker.organizationId === organizationId,
    );
  }
}

export interface WorkerMessageContext {
  messageId: string;
  workerId: string;
}

export interface RedisWorkerOptions {
  queue: RedisQueue;
  queueName: string;
  workerId: string;
  reclaimIdleMs?: number;
  batchSize?: number;
  blockMs?: number;
  reconnectDelayMs?: number;
  onError?: (error: unknown, message: RedisQueueMessage<unknown>) => void;
  onRuntimeError?: (error: unknown) => void;
}

/**
 * At-least-once worker loop for build agents.
 *
 * A failed handler deliberately leaves the stream entry pending. Another
 * worker can reclaim it after `reclaimIdleMs`; the handler must therefore be
 * idempotent and publish its result using the build id as its deduplication
 * key. This runtime does not execute arbitrary commands itself: platform
 * workers provide the handler inside their isolated Linux/macOS environment.
 */
export class RedisWorkerRuntime<T = unknown> {
  private running = false;

  constructor(readonly options: RedisWorkerOptions) {}

  async run(
    handler: (payload: T, context: WorkerMessageContext) => Promise<void>,
  ): Promise<void> {
    assert(
      !this.running,
      "WORKER_RUNNING",
      "Worker runtime is already running",
    );
    this.running = true;
    while (this.running) {
      try {
        const messages = [
          ...(await this.options.queue.reclaim<T>(
            this.options.queueName,
            this.options.workerId,
            this.options.reclaimIdleMs ?? 30_000,
            this.options.batchSize ?? 10,
          )),
          ...(await this.options.queue.consume<T>(
            this.options.queueName,
            this.options.workerId,
            {
              count: this.options.batchSize ?? 10,
              blockMs: this.options.blockMs ?? 5_000,
            },
          )),
        ];
        for (const message of messages) {
          try {
            await handler(message.payload, {
              messageId: message.id,
              workerId: this.options.workerId,
            });
            await this.options.queue.ack(this.options.queueName, message.id);
          } catch (error) {
            this.options.onError?.(
              error,
              message as RedisQueueMessage<unknown>,
            );
          }
        }
      } catch (error) {
        this.options.onRuntimeError?.(error);
        await delay(this.options.reconnectDelayMs ?? 1_000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
