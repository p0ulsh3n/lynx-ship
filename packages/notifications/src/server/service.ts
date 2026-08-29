import {
  MAX_FANOUT,
  NotificationError,
  validateIdentifier,
  type NotificationPlatform,
  type PushTokenStore,
} from "./core.js";
import type { PushPayload } from "./payloads.js";
import { validatePayload } from "./providers.js";
import type { PushProvider } from "./providers.js";

export interface PushServiceOptions {
  store: PushTokenStore;
  providers: PushProvider[];
  maxFanout?: number;
}

export interface SendToUserInput {
  userId: string;
  organizationId: string;
  projectId: string;
  payload: PushPayload;
}

export interface SendToUserResult {
  attempted: number;
  accepted: number;
  disabled: number;
  failures: Array<{
    destinationId: string;
    code: NotificationError["code"];
  }>;
}

export class PushService {
  private readonly store: PushTokenStore;

  private readonly providers = new Map<NotificationPlatform, PushProvider>();

  private readonly maxFanout: number;

  constructor(options: PushServiceOptions) {
    this.store = options.store;
    this.maxFanout = Math.min(options.maxFanout ?? MAX_FANOUT, MAX_FANOUT);
    if (this.maxFanout < 1)
      throw new NotificationError(
        "INVALID_INPUT",
        "maxFanout must be positive",
      );
    for (const provider of options.providers) {
      if (this.providers.has(provider.platform))
        throw new NotificationError(
          "INVALID_INPUT",
          `duplicate provider for ${provider.platform}`,
        );
      this.providers.set(provider.platform, provider);
    }
  }

  async sendToUser(input: SendToUserInput): Promise<SendToUserResult> {
    validateIdentifier(input.userId, "userId");
    validateIdentifier(input.organizationId, "organizationId");
    validateIdentifier(input.projectId, "projectId");
    validatePayload(input.payload);
    const destinations = await this.store.listActive(input);
    if (destinations.length > this.maxFanout)
      throw new NotificationError(
        "FANOUT_LIMIT",
        "notification fan-out exceeds the configured limit",
      );
    const result: SendToUserResult = {
      attempted: destinations.length,
      accepted: 0,
      disabled: 0,
      failures: [],
    };
    for (const destination of destinations) {
      const provider = this.providers.get(destination.platform);
      if (!provider) {
        result.failures.push({
          destinationId: destination.id,
          code: "PROVIDER_UNAVAILABLE",
        });
        continue;
      }
      try {
        await provider.send({ destination, payload: input.payload });
        await this.store.markDelivered(destination.id);
        result.accepted += 1;
      } catch (error) {
        const typed =
          error instanceof NotificationError
            ? error
            : new NotificationError(
                "PROVIDER_UNAVAILABLE",
                "Notification provider failed",
                { cause: error },
              );
        result.failures.push({
          destinationId: destination.id,
          code: typed.code,
        });
        if (typed.permanent) {
          await this.store.disable(destination.id);
          result.disabled += 1;
        }
      }
    }
    return result;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.providers.values()]
        .filter((provider) => provider.close)
        .map((provider) => provider.close!()),
    );
  }
}
