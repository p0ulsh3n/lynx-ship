import { createHash } from "node:crypto";

export type TelemetryEventName =
  | "check"
  | "activation"
  | "failed_launch"
  | "rollback";

export interface TelemetryEvent {
  projectId: string;
  releaseId: string;
  installationHash: string;
  event: TelemetryEventName;
  metadata: Record<string, unknown>;
  at: string;
}

export class TelemetryStore {
  events: TelemetryEvent[] = [];

  record(input: {
    projectId: string;
    releaseId: string;
    installationId: string;
    event: TelemetryEventName;
    metadata?: Record<string, unknown>;
  }): TelemetryEvent {
    const item: TelemetryEvent = {
      projectId: input.projectId,
      releaseId: input.releaseId,
      installationHash: createHash("sha256")
        .update(input.installationId)
        .digest("hex")
        .slice(0, 16),
      event: input.event,
      metadata: input.metadata ?? {},
      at: new Date().toISOString(),
    };
    this.events.push(item);
    return item;
  }

  aggregate(releaseId: string) {
    const events = this.events.filter((item) => item.releaseId === releaseId);
    return {
      checks: events.filter((item) => item.event === "check").length,
      activations: events.filter((item) => item.event === "activation").length,
      failures: events.filter((item) => item.event === "failed_launch").length,
      rollbacks: events.filter((item) => item.event === "rollback").length,
    };
  }
}
