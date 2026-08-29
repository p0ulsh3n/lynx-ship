import {
  DEFAULT_TTL_SECONDS,
  MAX_PAYLOAD_BYTES,
  NotificationError,
  assertHttps,
  jsonBytes,
  safeJson,
  validateIdentifier,
  validateProviderDestination,
  type Clock,
} from "../core.js";
import { PushProviderError, validatePayload } from "../provider-validation.js";
import type {
  HuaweiPushCredentials,
  HuaweiPushProviderOptions,
  PushProvider,
  PushSendRequest,
  PushSendResult,
} from "../provider-types.js";

/** Huawei Push Kit provider for HarmonyOS push tokens. */
export class HuaweiPushProvider implements PushProvider {
  readonly name = "huawei" as const;

  readonly platform = "harmony" as const;

  private readonly credentials: HuaweiPushCredentials;

  private readonly fetchImpl: typeof fetch;

  private readonly now: Clock;

  private readonly endpoint: string;

  private readonly tokenEndpoint: string;

  private accessToken: { value: string; expiresAt: number } | null = null;

  private accessTokenRequest: Promise<string> | null = null;

  constructor(
    credentials: HuaweiPushCredentials,
    options: HuaweiPushProviderOptions = {},
  ) {
    validateIdentifier(credentials.clientId, "clientId");
    if (!credentials.clientSecret.trim())
      throw new NotificationError(
        "INVALID_INPUT",
        "Huawei Push Kit client secret is required",
      );
    this.credentials = credentials;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.endpoint =
      options.endpoint ??
      `https://push-api.cloud.huawei.com/v1/${encodeURIComponent(credentials.clientId)}/messages:send`;
    this.tokenEndpoint =
      options.tokenEndpoint ??
      "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
    assertHttps(this.endpoint, "Huawei Push Kit endpoint");
    assertHttps(this.tokenEndpoint, "Huawei OAuth endpoint");
  }

  async send(request: PushSendRequest): Promise<PushSendResult> {
    validateProviderDestination(request.destination, this.platform);
    validatePayload(request.payload);
    const background = request.payload.kind === "background";
    const data = JSON.stringify(request.payload.data ?? {});
    const notification =
      !background && (request.payload.title || request.payload.body)
        ? {
            ...(request.payload.title ? { title: request.payload.title } : {}),
            ...(request.payload.body ? { body: request.payload.body } : {}),
            ...(request.payload.imageUrl
              ? { image: request.payload.imageUrl }
              : {}),
          }
        : undefined;
    const androidNotification = notification
      ? {
          ...notification,
          ...(request.payload.sound ? { sound: request.payload.sound } : {}),
        }
      : undefined;
    const message = {
      data,
      ...(notification ? { notification } : {}),
      android: {
        urgency: background ? "NORMAL" : "HIGH",
        ttl: `${request.payload.ttlSeconds ?? DEFAULT_TTL_SECONDS}s`,
        ...(request.payload.collapseId
          ? { collapse_key: request.payload.collapseId }
          : {}),
        ...(androidNotification ? { notification: androidNotification } : {}),
      },
      token: [request.destination.token],
    };
    const body = { validate_only: false, message };
    if (jsonBytes(body) > MAX_PAYLOAD_BYTES)
      throw new NotificationError(
        "PAYLOAD_TOO_LARGE",
        "Huawei Push Kit payload exceeds 4096 bytes",
      );
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new PushProviderError(
        "PROVIDER_UNAVAILABLE",
        "Huawei Push Kit request failed",
        { cause: error },
      );
    }
    const text = await response.text();
    const parsed = safeJson(text) as {
      code?: unknown;
      requestId?: unknown;
    } | null;
    const providerCode = typeof parsed?.code === "string" ? parsed.code : null;
    if (!response.ok || providerCode !== "80000000") {
      const permanent = providerCode === "80300007";
      const auth =
        response.status === 401 ||
        response.status === 403 ||
        providerCode === "80200001" ||
        providerCode === "80200003";
      throw new PushProviderError(
        auth ? "PROVIDER_AUTH" : "PROVIDER_REJECTED",
        "Huawei Push Kit rejected the notification",
        { providerCode, permanent },
      );
    }
    return {
      provider: this.name,
      destinationId: request.destination.id,
      accepted: true,
      ...(typeof parsed?.requestId === "string"
        ? { providerMessageId: parsed.requestId }
        : {}),
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000)
      return this.accessToken.value;
    if (this.accessTokenRequest) return this.accessTokenRequest;
    this.accessTokenRequest = this.fetchAccessToken(now);
    try {
      return await this.accessTokenRequest;
    } finally {
      this.accessTokenRequest = null;
    }
  }

  private async fetchAccessToken(now: number): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
        }),
      });
    } catch (error) {
      throw new PushProviderError(
        "PROVIDER_UNAVAILABLE",
        "Huawei OAuth request failed",
        { cause: error },
      );
    }
    const text = await response.text();
    if (!response.ok)
      throw new PushProviderError(
        "PROVIDER_AUTH",
        "Huawei OAuth authentication failed",
      );
    const parsed = safeJson(text) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (
      typeof parsed?.access_token !== "string" ||
      !parsed.access_token.trim() ||
      typeof parsed.expires_in !== "number" ||
      !Number.isFinite(parsed.expires_in) ||
      parsed.expires_in <= 0
    )
      throw new PushProviderError(
        "PROVIDER_AUTH",
        "Huawei OAuth returned an invalid access token",
      );
    const value = parsed.access_token.trim();
    this.accessToken = {
      value,
      expiresAt: now + Math.max(60, parsed.expires_in) * 1_000,
    };
    return value;
  }
}
