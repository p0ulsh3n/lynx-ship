const MAX_SYNC_PAGE_BYTES = 256 * 1024;
const MAX_SYNC_EVENTS = 100;

export type NotificationPlatform = "android" | "ios" | "harmony";

export type NotificationEnvironment = "development" | "production";

export class NotificationError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "INVALID_URL"
    | "PERMISSION_DENIED"
    | "PROVIDER_UNAVAILABLE"
    | "SYNC_INVALID";

  constructor(
    code: NotificationError["code"],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "NotificationError";
    this.code = code;
  }
}

export interface RegisterPushTokenInput {
  userId: string;
  organizationId: string;
  projectId: string;
  platform: NotificationPlatform;
  appId: string;
  environment: NotificationEnvironment;
  token: string;
}

export interface PushDeviceAdapter {
  platform: NotificationPlatform;
  appId: string;
  environment: NotificationEnvironment;
  requestPermission?: () => Promise<boolean>;
  getToken: () => Promise<string | null>;
}

export interface PushTokenChangeSubscription {
  remove(): void;
}

export interface PushTokenChangeAdapter extends PushDeviceAdapter {
  onTokenChange?: (
    listener: (token: string) => void | Promise<void>,
  ) => PushTokenChangeSubscription;
}

export interface RegisterDeviceTransport {
  register(input: RegisterPushTokenInput): Promise<void>;
}

export interface RegisterDeviceTransportOptions {
  endpoint: string;
  accessToken: string | (() => string | Promise<string>);
  fetch?: typeof fetch;
}

export class PushRegistrationClient {
  constructor(
    private readonly adapter: PushDeviceAdapter,
    private readonly transport: RegisterDeviceTransport,
    private readonly identity: Omit<
      RegisterPushTokenInput,
      "platform" | "appId" | "environment" | "token"
    >,
  ) {}

  async register(): Promise<
    "registered" | "permission-denied" | "unavailable"
  > {
    if (
      this.adapter.requestPermission &&
      !(await this.adapter.requestPermission())
    )
      return "permission-denied";
    const token = await this.adapter.getToken();
    if (!token) return "unavailable";
    await this.registerToken(token);
    return "registered";
  }

  /** Register a newly rotated native token without requesting permission again. */
  async registerToken(token: string): Promise<void> {
    const normalizedToken = token.trim();
    if (
      !normalizedToken ||
      normalizedToken.length > 4096 ||
      /[\0\r\n]/.test(normalizedToken)
    )
      throw new NotificationError("INVALID_INPUT", "push token is invalid");
    await this.transport.register({
      ...this.identity,
      platform: this.adapter.platform,
      appId: this.adapter.appId,
      environment: this.adapter.environment,
      token: normalizedToken,
    });
  }
}

/**
 * Create the client-safe HTTPS transport shared by Expo and pure Lynx hosts.
 * The server implementation is deliberately kept out of this module.
 */
export function createHttpRegisterDeviceTransport(
  options: RegisterDeviceTransportOptions,
): RegisterDeviceTransport {
  assertSecureEndpoint(options.endpoint);
  return {
    register: async (input: RegisterPushTokenInput) => {
      const fetchImpl = options.fetch ?? fetch;
      const accessToken =
        typeof options.accessToken === "function"
          ? await options.accessToken()
          : options.accessToken;
      if (!accessToken?.trim())
        throw new NotificationError("INVALID_INPUT", "access token is empty");
      let response: Response;
      try {
        response = await fetchImpl(options.endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(input),
        });
      } catch (error) {
        throw new NotificationError(
          "PROVIDER_UNAVAILABLE",
          "push registration endpoint is unavailable",
          { cause: error },
        );
      }
      if (!response.ok)
        throw new NotificationError(
          "PROVIDER_UNAVAILABLE",
          "push registration endpoint rejected the request",
        );
    },
  };
}

export interface SyncEnvelope {
  id: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface SyncPage {
  events: SyncEnvelope[];
  nextCursor: string | null;
}

export interface CursorStore {
  get(): Promise<string | null>;
  set(cursor: string): Promise<void>;
}

export class RealtimeCatchUpClient {
  constructor(
    private readonly options: {
      endpoint: string;
      token: string | (() => string | Promise<string>);
      cursorStore: CursorStore;
      fetch?: typeof fetch;
      maxPages?: number;
    },
  ) {
    const parsed = new URL(options.endpoint);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      throw new NotificationError(
        "INVALID_URL",
        "sync endpoint must use https://",
      );
    if (
      parsed.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
      throw new NotificationError(
        "INVALID_URL",
        "production sync endpoint must use https://",
      );
  }

  async sync(
    onEvent: (event: SyncEnvelope) => Promise<void> | void,
  ): Promise<number> {
    const fetchImpl = this.options.fetch ?? fetch;
    const maxPages = Math.min(Math.max(this.options.maxPages ?? 20, 1), 100);
    let cursor = await this.options.cursorStore.get();
    let pages = 0;
    let processed = 0;
    while (pages < maxPages) {
      const url = new URL(this.options.endpoint);
      if (cursor) url.searchParams.set("after", cursor);
      const token =
        typeof this.options.token === "function"
          ? await this.options.token()
          : this.options.token;
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok)
        throw new NotificationError(
          "PROVIDER_UNAVAILABLE",
          "sync request failed",
        );
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_SYNC_PAGE_BYTES)
        throw new NotificationError(
          "SYNC_INVALID",
          "sync response exceeds the configured size limit",
        );
      const page = parseSyncPage(body);
      for (const event of page.events) {
        await onEvent(event);
        processed += 1;
      }
      pages += 1;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      await this.options.cursorStore.set(cursor);
    }
    return processed;
  }
}

function parseSyncPage(value: string): SyncPage {
  let parsed: { events?: unknown; nextCursor?: unknown } | null;
  try {
    parsed = JSON.parse(value) as { events?: unknown; nextCursor?: unknown };
  } catch (error) {
    throw new NotificationError("SYNC_INVALID", "sync response is not JSON", {
      cause: error,
    });
  }
  if (!Array.isArray(parsed?.events))
    throw new NotificationError("SYNC_INVALID", "sync response is invalid");
  if (parsed.events.length > MAX_SYNC_EVENTS)
    throw new NotificationError(
      "SYNC_INVALID",
      "sync response contains too many events",
    );
  const events: SyncEnvelope[] = [];
  for (const value of parsed.events) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new NotificationError("SYNC_INVALID", "sync event is invalid");
    const event = value as Record<string, unknown>;
    if (
      typeof event.id !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(event.id) ||
      typeof event.type !== "string" ||
      !/^[a-z][a-z0-9._:-]{0,63}$/.test(event.type) ||
      typeof event.ts !== "number" ||
      !Number.isSafeInteger(event.ts) ||
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    )
      throw new NotificationError(
        "SYNC_INVALID",
        "sync event has an invalid envelope",
      );
    events.push(event as unknown as SyncEnvelope);
  }
  if (parsed.nextCursor !== null && typeof parsed.nextCursor !== "string")
    throw new NotificationError("SYNC_INVALID", "sync cursor is invalid");
  return {
    events,
    nextCursor: parsed.nextCursor as string | null,
  };
}

export function assertSecureEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch (error) {
    throw new NotificationError(
      "INVALID_URL",
      "registration endpoint is invalid",
      { cause: error },
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
  )
    throw new NotificationError(
      "INVALID_URL",
      "registration endpoint must use https:// outside localhost",
    );
}
