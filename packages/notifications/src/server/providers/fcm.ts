import { createSign } from "node:crypto";
import {
  DEFAULT_TTL_SECONDS,
  FCM_SCOPE,
  FCM_TOKEN_AUDIENCE,
  MAX_PAYLOAD_BYTES,
  NotificationError,
  base64Url,
  jsonBase64Url,
  jsonBytes,
  parseProviderError,
  safeJson,
  validateIdentifier,
  validateProviderDestination,
  type Clock,
} from "../core.js";
import { PushProviderError, validatePayload } from "../provider-validation.js";
import type {
  FcmServiceAccount,
  PushProvider,
  PushSendRequest,
  PushSendResult,
} from "../provider-types.js";

export class FcmProvider implements PushProvider {
  readonly name = "fcm" as const;

  readonly platform = "android" as const;

  private readonly account: FcmServiceAccount;

  private readonly fetchImpl: typeof fetch;

  private readonly now: Clock;

  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    account: FcmServiceAccount,
    options: { fetch?: typeof fetch; now?: Clock } = {},
  ) {
    validateIdentifier(account.projectId, "projectId");
    if (!account.clientEmail || !account.privateKey)
      throw new NotificationError(
        "INVALID_INPUT",
        "FCM service account is incomplete",
      );
    this.account = account;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async send(request: PushSendRequest): Promise<PushSendResult> {
    validateProviderDestination(request.destination, this.platform);
    validatePayload(request.payload);
    const message: Record<string, unknown> = {
      token: request.destination.token,
      data: request.payload.data ?? {},
    };
    if (
      request.payload.kind !== "background" &&
      (request.payload.title || request.payload.body)
    )
      message.notification = {
        ...(request.payload.title ? { title: request.payload.title } : {}),
        ...(request.payload.body ? { body: request.payload.body } : {}),
        ...(request.payload.imageUrl
          ? { image: request.payload.imageUrl }
          : {}),
      };
    message.android = {
      priority: request.payload.kind === "background" ? "NORMAL" : "HIGH",
      ttl: `${request.payload.ttlSeconds ?? DEFAULT_TTL_SECONDS}s`,
      ...(request.payload.collapseId
        ? { collapseKey: request.payload.collapseId }
        : {}),
    };
    if (jsonBytes({ message }) > MAX_PAYLOAD_BYTES)
      throw new NotificationError(
        "PAYLOAD_TOO_LARGE",
        "FCM payload exceeds 4096 bytes",
      );
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.projectId)}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message }),
        },
      );
    } catch (error) {
      throw new PushProviderError(
        "PROVIDER_UNAVAILABLE",
        "FCM request failed",
        { cause: error },
      );
    }
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseProviderError(text);
      const permanent = ["UNREGISTERED", "SENDER_ID_MISMATCH"].includes(
        parsed.code ?? "",
      );
      throw new PushProviderError(
        response.status === 401 || response.status === 403
          ? "PROVIDER_AUTH"
          : "PROVIDER_REJECTED",
        "FCM rejected the notification",
        { providerCode: parsed.code, permanent },
      );
    }
    const parsed = safeJson(text) as { name?: unknown } | null;
    return {
      provider: this.name,
      destinationId: request.destination.id,
      accepted: true,
      ...(typeof parsed?.name === "string"
        ? { providerMessageId: parsed.name }
        : {}),
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000)
      return this.accessToken.value;
    const issuedAt = Math.floor(now / 1000);
    const assertionHeader = jsonBase64Url({ alg: "RS256", typ: "JWT" });
    const assertionPayload = jsonBase64Url({
      iss: this.account.clientEmail,
      scope: FCM_SCOPE,
      aud: FCM_TOKEN_AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + 3_600,
    });
    const signer = createSign("RSA-SHA256");
    signer.update(`${assertionHeader}.${assertionPayload}`);
    const assertion = `${assertionHeader}.${assertionPayload}.${base64Url(signer.sign(this.account.privateKey))}`;
    let response: Response;
    try {
      response = await this.fetchImpl(FCM_TOKEN_AUDIENCE, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });
    } catch (error) {
      throw new PushProviderError(
        "PROVIDER_UNAVAILABLE",
        "FCM authentication request failed",
        { cause: error },
      );
    }
    const text = await response.text();
    if (!response.ok)
      throw new PushProviderError(
        "PROVIDER_AUTH",
        "FCM authentication failed",
        { providerCode: "OAUTH_REJECTED" },
      );
    const parsed = safeJson(text) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (
      typeof parsed?.access_token !== "string" ||
      typeof parsed.expires_in !== "number" ||
      !Number.isFinite(parsed.expires_in)
    )
      throw new PushProviderError(
        "PROVIDER_AUTH",
        "FCM returned an invalid access token",
      );
    this.accessToken = {
      value: parsed.access_token,
      expiresAt: now + Math.max(60, parsed.expires_in) * 1_000,
    };
    return parsed.access_token;
  }
}
