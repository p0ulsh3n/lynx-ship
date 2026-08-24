import { assert } from "@lynxship/contracts";
import { IdGenerator } from "@lynxship/storage";

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorId: string | null;
  event: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class AuditLog {
  events: AuditEvent[] = [];

  record(input: {
    organizationId: string;
    actorId?: string | null;
    event: string;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  }): AuditEvent {
    const item: AuditEvent = Object.freeze({
      id: IdGenerator.create("audit"),
      organizationId: input.organizationId,
      actorId: input.actorId ?? null,
      event: input.event,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: structuredClone(input.metadata ?? {}),
      createdAt: new Date().toISOString(),
    });
    this.events.push(item);
    return item;
  }

  list(organizationId?: string): AuditEvent[] {
    return this.events.filter(
      (event) => !organizationId || event.organizationId === organizationId,
    );
  }
}
