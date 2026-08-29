import type {
  Clock,
  NotificationEnvironment,
  NotificationPlatform,
  PushDestination,
} from "./core.js";
import type { PushPayload } from "./payloads.js";

export interface PushSendRequest {
  destination: PushDestination;
  payload: PushPayload;
}

export interface PushSendResult {
  provider: "fcm" | "apns" | "huawei";
  destinationId: string;
  accepted: boolean;
  providerMessageId?: string;
}

export interface PushProvider {
  readonly name: "fcm" | "apns" | "huawei";
  readonly platform: NotificationPlatform;
  send(request: PushSendRequest): Promise<PushSendResult>;
  close?(): Promise<void>;
}

export interface FcmServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface ApnsCredentials {
  teamId: string;
  keyId: string;
  bundleId: string;
  privateKey: string;
  environment: NotificationEnvironment;
}

export interface HuaweiPushCredentials {
  /** AppGallery Connect client ID used by the Push Kit REST endpoint. */
  clientId: string;
  /** OAuth client secret. Keep this on the server only. */
  clientSecret: string;
}

export interface HuaweiPushProviderOptions {
  fetch?: typeof fetch;
  now?: Clock;
  /** Test-only or private gateway override; production must remain HTTPS. */
  endpoint?: string;
  tokenEndpoint?: string;
}
