import {
  assert,
  createId,
  type Platform,
  type Worker,
} from "@lynxship/contracts";

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
