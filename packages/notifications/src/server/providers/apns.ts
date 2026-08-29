import { createSign } from "node:crypto";
import { connect as connectHttp2, type ClientHttp2Session } from "node:http2";
import {
  MAX_PAYLOAD_BYTES,
  NotificationError,
  base64Url,
  jsonBase64Url,
  jsonBytes,
  safeJson,
  validateIdentifier,
  validateProviderDestination,
  type Clock,
} from "../core.js";
import { PushProviderError, validatePayload } from "../provider-validation.js";
import type {
  ApnsCredentials,
  PushProvider,
  PushSendRequest,
  PushSendResult,
} from "../provider-types.js";

export class ApnsProvider implements PushProvider {
  readonly name = "apns" as const;

  readonly platform = "ios" as const;

  private readonly credentials: ApnsCredentials;

  private readonly now: Clock;

  private session: ClientHttp2Session | null = null;

  private providerToken: { value: string; expiresAt: number } | null = null;

  constructor(credentials: ApnsCredentials, now: Clock = Date.now) {
    validateIdentifier(credentials.teamId, "teamId");
    validateIdentifier(credentials.keyId, "keyId");
    validateIdentifier(credentials.bundleId, "bundleId");
    if (!credentials.privateKey)
      throw new NotificationError(
        "INVALID_INPUT",
        "APNs private key is required",
      );
    if (
      credentials.environment !== "development" &&
      credentials.environment !== "production"
    )
      throw new NotificationError(
        "INVALID_INPUT",
        "APNs environment is invalid",
      );
    this.credentials = credentials;
    this.now = now;
  }

  async send(request: PushSendRequest): Promise<PushSendResult> {
    validateProviderDestination(request.destination, this.platform);
    validatePayload(request.payload);
    if (!/^[a-f0-9]+$/i.test(request.destination.token))
      throw new NotificationError(
        "INVALID_INPUT",
        "APNs device token is invalid",
      );
    const background = request.payload.kind === "background";
    const aps: Record<string, unknown> = background
      ? { "content-available": 1 }
      : {
          ...(request.payload.title || request.payload.body
            ? {
                alert: {
                  ...(request.payload.title
                    ? { title: request.payload.title }
                    : {}),
                  ...(request.payload.subtitle
                    ? { subtitle: request.payload.subtitle }
                    : {}),
                  ...(request.payload.body
                    ? { body: request.payload.body }
                    : {}),
                },
              }
            : {}),
          ...(request.payload.sound ? { sound: request.payload.sound } : {}),
          ...(request.payload.badge !== undefined
            ? { badge: request.payload.badge }
            : {}),
          ...(request.payload.imageUrl ? { "mutable-content": 1 } : {}),
        };
    const payload = {
      aps,
      ...(request.payload.data ?? {}),
      ...(request.payload.imageUrl
        ? { "lynxship.image-url": request.payload.imageUrl }
        : {}),
    };
    if (jsonBytes(payload) > MAX_PAYLOAD_BYTES)
      throw new NotificationError(
        "PAYLOAD_TOO_LARGE",
        "APNs payload exceeds 4096 bytes",
      );
    const providerToken = this.getProviderToken();
    const authority =
      this.credentials.environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
    const response = await this.sendHttp2(
      authority,
      {
        ":method": "POST",
        ":path": `/3/device/${request.destination.token}`,
        authorization: `bearer ${providerToken}`,
        "apns-topic": this.credentials.bundleId,
        "apns-push-type": background ? "background" : "alert",
        "apns-priority": background ? "5" : "10",
        ...(request.payload.collapseId
          ? { "apns-collapse-id": request.payload.collapseId }
          : {}),
        ...(request.payload.threadId
          ? { "apns-thread-id": request.payload.threadId }
          : {}),
        ...(request.payload.ttlSeconds !== undefined
          ? {
              "apns-expiration": String(
                Math.floor(this.now() / 1_000) + request.payload.ttlSeconds,
              ),
            }
          : {}),
      },
      JSON.stringify(payload),
    );
    if (response.status < 200 || response.status >= 300) {
      const parsed = safeJson(response.body) as { reason?: unknown } | null;
      const reason =
        typeof parsed?.reason === "string" ? parsed.reason : "APNS_REJECTED";
      const permanent = [
        "BadDeviceToken",
        "DeviceTokenNotForTopic",
        "Unregistered",
      ].includes(reason);
      throw new PushProviderError(
        "PROVIDER_REJECTED",
        "APNs rejected the notification",
        { providerCode: reason, permanent },
      );
    }
    return {
      provider: this.name,
      destinationId: request.destination.id,
      accepted: true,
      ...(response.apnsId ? { providerMessageId: response.apnsId } : {}),
    };
  }

  async close(): Promise<void> {
    this.session?.close();
    this.session = null;
  }

  private getProviderToken(): string {
    const now = this.now();
    if (this.providerToken && this.providerToken.expiresAt > now + 60_000)
      return this.providerToken.value;
    const issuedAt = Math.floor(now / 1_000);
    const header = jsonBase64Url({
      alg: "ES256",
      kid: this.credentials.keyId,
      typ: "JWT",
    });
    const payload = jsonBase64Url({
      iss: this.credentials.teamId,
      iat: issuedAt,
    });
    const signer = createSign("SHA256");
    signer.update(`${header}.${payload}`);
    const signature = base64Url(signer.sign(this.credentials.privateKey));
    const value = `${header}.${payload}.${signature}`;
    this.providerToken = { value, expiresAt: now + 50 * 60_000 };
    return value;
  }

  private async sendHttp2(
    authority: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; body: string; apnsId?: string }> {
    const session = this.getSession(authority);
    return new Promise((resolve, reject) => {
      const request = session.request(headers);
      const chunks: string[] = [];
      let status = 0;
      let apnsId: string | undefined;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(
          new PushProviderError("PROVIDER_UNAVAILABLE", "APNs request failed", {
            cause: error,
          }),
        );
      };
      request.setEncoding("utf8");
      request.on("response", (responseHeaders) => {
        status = Number(responseHeaders[":status"] ?? 0);
        const value = responseHeaders["apns-id"];
        if (typeof value === "string") apnsId = value;
      });
      request.on("data", (chunk: string) => chunks.push(chunk));
      request.on("error", fail);
      request.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status,
          body: chunks.join(""),
          ...(apnsId ? { apnsId } : {}),
        });
      });
      request.end(body);
    });
  }

  private getSession(authority: string): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed)
      return this.session;
    this.session = connectHttp2(authority, { rejectUnauthorized: true });
    this.session.on("error", () => {
      this.session = null;
    });
    this.session.on("close", () => {
      this.session = null;
    });
    return this.session;
  }
}
