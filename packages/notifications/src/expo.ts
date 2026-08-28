import {
  assertSecureEndpoint,
  createHttpRegisterDeviceTransport,
  NotificationError,
  PushRegistrationClient,
  type NotificationEnvironment,
  type NotificationPlatform,
  type PushTokenChangeSubscription,
} from "./client.js";

export { createHttpRegisterDeviceTransport } from "./client.js";

interface ExpoNotifications {
  setNotificationChannelAsync?(
    channelId: string,
    channel: Record<string, unknown>,
  ): Promise<unknown>;
  getPermissionsAsync(): Promise<{ granted: boolean }>;
  requestPermissionsAsync(
    options?: Record<string, unknown>,
  ): Promise<{ granted: boolean }>;
  getDevicePushTokenAsync(): Promise<{
    type: string;
    data: string | Uint8Array;
  }>;
  addPushTokenListener(
    listener: (token: { type: string; data: string | Uint8Array }) => void,
  ): PushTokenChangeSubscription;
}

export interface ExpoPushRegistrationOptions {
  userId: string;
  organizationId: string;
  projectId: string;
  /** HTTPS endpoint that accepts RegisterPushTokenInput as JSON. */
  endpoint: string;
  /** Access token or a function that returns the current short-lived token. */
  accessToken: string | (() => string | Promise<string>);
  platform?: NotificationPlatform;
  /** Override the app identifier when the Expo config cannot provide it. */
  appId?: string;
  environment?: NotificationEnvironment;
  /** Dependency injection hooks used by tests and custom Expo hosts. */
  notifications?: ExpoNotifications;
  reactNative?: { Platform: { OS: string } };
  constants?: { expoConfig?: ExpoPushConstantsConfig | null };
  /** Android notification channel created before requesting the token. */
  androidChannel?: {
    id?: string;
    name?: string;
    importance?: number;
    sound?: string;
    vibrationPattern?: number[];
  };
  fetch?: typeof fetch;
  /** Receives a redacted error if a later token rotation cannot be registered. */
  onTokenChangeError?: (error: unknown) => void;
}

export interface ExpoPushRegistration {
  status: "registered" | "permission-denied" | "unavailable";
  platform: NotificationPlatform;
  /** Stop listening for future native token rotations. */
  stop(): void;
}

export interface ExpoPushAdapterOptions {
  platform?: NotificationPlatform;
  appId?: string;
  environment?: NotificationEnvironment;
  androidChannel?: ExpoPushRegistrationOptions["androidChannel"];
  notifications?: ExpoNotifications;
  reactNative?: { Platform: { OS: string } };
  constants?: { expoConfig?: ExpoPushConstantsConfig | null };
}

interface ExpoPushConstantsConfig {
  android?: { package?: string };
  ios?: { bundleIdentifier?: string };
}

/**
 * Create the official Expo native FCM/APNs adapter.
 *
 * This intentionally uses getDevicePushTokenAsync, not ExpoPushToken: the
 * LynxShip server providers send directly through FCM/APNs. The native
 * permission decision remains owned by Android/iOS.
 */
export async function createExpoPushAdapter(
  options: ExpoPushAdapterOptions = {},
) {
  const notifications =
    options.notifications ?? (await import("expo-notifications"));
  const reactNative = options.reactNative ?? (await import("react-native"));
  const platform = options.platform ?? platformFromReactNative(reactNative);
  if (platform !== "android" && platform !== "ios")
    throw new NotificationError(
      "INVALID_INPUT",
      "Expo notifications supports only android or ios",
    );
  const appId =
    options.appId ??
    appIdFromConfig(
      options.constants ?? (await import("expo-constants")).default,
      platform,
    );
  const environment = options.environment ?? "production";

  if (!appId)
    throw new NotificationError(
      "INVALID_INPUT",
      "Expo appId is required in options or Expo app config",
    );
  if (!notifications.getDevicePushTokenAsync)
    throw new NotificationError(
      "PROVIDER_UNAVAILABLE",
      "expo-notifications native module is unavailable; use a development build",
    );

  if (platform === "android") {
    const channel = options.androidChannel;
    await notifications.setNotificationChannelAsync?.(
      channel?.id ?? "default",
      {
        name: channel?.name ?? "default",
        importance: channel?.importance ?? 4,
        ...(channel?.sound ? { sound: channel.sound } : {}),
        ...(channel?.vibrationPattern
          ? { vibrationPattern: channel.vibrationPattern }
          : {}),
      },
    );
  }

  return {
    platform,
    appId,
    environment,
    requestPermission: async () => {
      const current = await notifications.getPermissionsAsync();
      if (current.granted) return true;
      const requested = await notifications.requestPermissionsAsync(
        platform === "ios"
          ? {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            }
          : undefined,
      );
      return requested.granted;
    },
    getToken: async () => {
      const nativeToken = await notifications.getDevicePushTokenAsync();
      return normalizeNativeToken(nativeToken.data);
    },
    onTokenChange: (listener: (token: string) => void | Promise<void>) =>
      notifications.addPushTokenListener((nativeToken) => {
        const token = normalizeNativeToken(nativeToken.data);
        if (token) void listener(token);
      }),
  };
}

/**
 * One-call Expo integration for direct FCM/APNs registration.
 *
 * The endpoint and authenticated user/project identity are deliberately
 * required: no client library can safely guess ownership or invent backend
 * credentials.
 */
export async function registerExpoPushNotifications(
  options: ExpoPushRegistrationOptions,
): Promise<ExpoPushRegistration> {
  validateRegistrationOptions(options);
  const adapter = await createExpoPushAdapter(options);
  const transport = createHttpRegisterDeviceTransport(options);
  const client = new PushRegistrationClient(adapter, transport, {
    userId: options.userId,
    organizationId: options.organizationId,
    projectId: options.projectId,
  });
  const status = await client.register();
  let subscription: PushTokenChangeSubscription | undefined;
  if (status === "registered" && adapter.onTokenChange) {
    subscription = adapter.onTokenChange(async (token) => {
      try {
        await client.registerToken(token);
      } catch (error) {
        options.onTokenChangeError?.(error);
      }
    });
  }
  return {
    status,
    platform: adapter.platform,
    stop: () => subscription?.remove(),
  };
}

/** Namespace-style API for the ergonomic `LynxShipNotifications.register()` call. */
export const LynxShipNotifications = Object.freeze({
  register: registerExpoPushNotifications,
});

function platformFromReactNative(reactNative: {
  Platform: { OS: string };
}): NotificationPlatform {
  if (reactNative.Platform.OS === "android") return "android";
  if (reactNative.Platform.OS === "ios") return "ios";
  throw new NotificationError(
    "PROVIDER_UNAVAILABLE",
    "LynxShip push registration supports Android and iOS only",
  );
}

function appIdFromConfig(
  constants: { expoConfig?: ExpoPushConstantsConfig | null },
  platform: NotificationPlatform,
): string | undefined {
  return platform === "android"
    ? constants.expoConfig?.android?.package
    : constants.expoConfig?.ios?.bundleIdentifier;
}

function normalizeNativeToken(value: string | Uint8Array): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!(value instanceof Uint8Array) || value.byteLength === 0) return null;
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function validateRegistrationOptions(
  options: ExpoPushRegistrationOptions,
): void {
  for (const [key, value] of Object.entries(options)) {
    if (["userId", "organizationId", "projectId", "endpoint"].includes(key)) {
      if (typeof value !== "string" || !value.trim())
        throw new NotificationError("INVALID_INPUT", `${key} is required`);
    }
  }
  assertSecureEndpoint(options.endpoint);
  if (
    typeof options.accessToken !== "string" &&
    typeof options.accessToken !== "function"
  )
    throw new NotificationError("INVALID_INPUT", "accessToken is required");
}
