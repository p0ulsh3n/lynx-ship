import { createHmac, randomBytes } from "node:crypto";
import { assert } from "@lynxship/contracts";
import { IdGenerator } from "@lynxship/storage";

export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  body: string;
  attempts: number;
  status: "pending" | "delivered" | "retry" | "dead";
  timestamp: number;
  signature: string;
}

export class WebhookService {
  readonly endpoints = new Map<string, WebhookEndpoint>();

  deliveries: WebhookDelivery[] = [];

  create(input: {
    organizationId: string;
    url: string;
    events: string[];
  }): WebhookEndpoint {
    const endpoint: WebhookEndpoint = {
      id: IdGenerator.create("wh"),
      organizationId: input.organizationId,
      url: input.url,
      events: input.events,
      secret: randomBytes(24).toString("base64url"),
      active: true,
    };
    this.endpoints.set(endpoint.id, endpoint);
    return { ...endpoint };
  }

  sign(id: string, body: string, timestamp = Date.now()) {
    const endpoint = this.endpoints.get(id);
    assert(endpoint, "WEBHOOK_NOT_FOUND", "Webhook not found");
    const digest = createHmac("sha256", endpoint.secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    return { timestamp, signature: `v1=${digest}` };
  }

  queue(id: string, event: string, payload: unknown): WebhookDelivery | null {
    const endpoint = this.endpoints.get(id);
    if (!endpoint?.active || !endpoint.events.includes(event)) return null;
    const body = JSON.stringify({
      id: IdGenerator.create("evt"),
      event,
      payload,
    });
    const signed = this.sign(id, body);
    const delivery: WebhookDelivery = {
      id: IdGenerator.create("del"),
      endpointId: id,
      event,
      body,
      attempts: 0,
      status: "pending",
      ...signed,
    };
    this.deliveries.push(delivery);
    return delivery;
  }

  recordResult(id: string, ok: boolean): WebhookDelivery {
    const delivery = this.deliveries.find((item) => item.id === id);
    assert(delivery, "WEBHOOK_DELIVERY_NOT_FOUND", "Delivery not found");
    delivery.attempts += 1;
    delivery.status = ok
      ? "delivered"
      : delivery.attempts >= 5
        ? "dead"
        : "retry";
    return delivery;
  }
}
