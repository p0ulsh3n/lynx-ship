import {
  createHttpRegisterDeviceTransport,
  NotificationError,
  PushRegistrationClient,
  type NotificationEnvironment,
  type NotificationPlatform,
  type PushTokenChangeSubscription,
} from "./client.js";

export interface LynxNativeNotificationsModule {
  /** Legacy/callback form used by Android and iOS native bridges. */
  requestPermission?: (callback: (granted: boolean) => void) => void;
  getToken?: (callback: (token: string) => void) => void;
  /** Async callback form used by the HarmonyOS bridge. */
  requestPermissionAsync?: (callback: (granted: boolean) => void) => void;
  getTokenAsync?: (callback: (token: string) => void) => void;
  /** Synchronous fallback exposed by the generated Harmony-compatible spec. */
  requestPermissionSync?: () => boolean;
  getTokenSync?: () => string;
  /** Optional native subscription. Startup registration remains the fallback. */
  subscribeTokenChanges?: (
    callback: (token: string) => void,
  ) => { remove?: () => void } | void;
  clearTokenChangeListeners?: () => void;
}

export interface LynxPushRegistrationOptions {
  userId: string;
  organizationId: string;
  projectId: string;
  platform: NotificationPlatform;
  appId: string;
  /** HTTPS endpoint that accepts RegisterPushTokenInput as JSON. */
  endpoint: string;
  /** Access token or a function returning the current short-lived token. */
  accessToken: string | (() => string | Promise<string>);
  environment?: NotificationEnvironment;
  /** Dependency injection hook for tests and custom Lynx hosts. */
  nativeModule?: LynxNativeNotificationsModule;
  fetch?: typeof fetch;
  /** Receives a redacted error if a later token rotation cannot be registered. */
  onTokenChangeError?: (error: unknown) => void;
}

export interface LynxPushRegistration {
  status: "registered" | "permission-denied" | "unavailable";
  platform: NotificationPlatform;
  /** Stop listening for native token rotations. */
  stop(): void;
}

/**
 * Resolve the module exposed by Lynx's global NativeModules object.
 * NativeModules is intentionally read at call time: importing this file must
 * remain safe in Node, web tooling, and unit tests.
 */
export function getLynxNotificationsModule(): LynxNativeNotificationsModule {
  const nativeModules = (
    globalThis as typeof globalThis & {
      NativeModules?: Record<string, unknown>;
    }
  ).NativeModules;
  const module = nativeModules?.LynxShipNotifications;
  if (!module || typeof module !== "object")
    throw new NotificationError(
      "PROVIDER_UNAVAILABLE",
      "LynxShipNotifications native module is not linked",
    );
  const candidate = module as Partial<LynxNativeNotificationsModule>;
  const hasPermissionBridge =
    typeof candidate.requestPermission === "function" ||
    typeof candidate.requestPermissionAsync === "function" ||
    typeof candidate.requestPermissionSync === "function";
  const hasTokenBridge =
    typeof candidate.getToken === "function" ||
    typeof candidate.getTokenAsync === "function" ||
    typeof candidate.getTokenSync === "function";
  if (!hasPermissionBridge || !hasTokenBridge)
    throw new NotificationError(
      "PROVIDER_UNAVAILABLE",
      "LynxShipNotifications native module is incomplete",
    );
  return candidate as LynxNativeNotificationsModule;
}

function nativeCall<T>(
  call: (callback: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve) => call(resolve));
}

/**
 * Register a pure Lynx app's native push token with its backend.
 *
 * This API is deliberately parallel to the Expo adapter, but has no React
 * Native or Expo dependency. It must be called from Lynx background-thread
 * scripting, where NativeModules is available in current Lynx releases.
 */
export async function registerLynxPushNotifications(
  options: LynxPushRegistrationOptions,
): Promise<LynxPushRegistration> {
  validateOptions(options);
  const nativeModule = options.nativeModule ?? getLynxNotificationsModule();
  const environment = options.environment ?? "production";
  const adapter = {
    platform: options.platform,
    appId: options.appId.trim(),
    environment,
    requestPermission: () => nativePermissionCall(nativeModule),
    getToken: () => nativeTokenCall(nativeModule),
  };
  const transport = createHttpRegisterDeviceTransport({
    endpoint: options.endpoint,
    accessToken: options.accessToken,
    fetch: options.fetch,
  });
  const client = new PushRegistrationClient(adapter, transport, {
    userId: options.userId.trim(),
    organizationId: options.organizationId.trim(),
    projectId: options.projectId.trim(),
  });
  const status = await client.register();
  let subscription: PushTokenChangeSubscription | undefined;
  if (
    (status === "registered" || status === "unavailable") &&
    nativeModule.subscribeTokenChanges
  ) {
    try {
      const nativeSubscription = nativeModule.subscribeTokenChanges((token) => {
        void client.registerToken(token).catch((error: unknown) => {
          options.onTokenChangeError?.(error);
        });
      });
      subscription = {
        remove: () => {
          nativeSubscription?.remove?.();
          nativeModule.clearTokenChangeListeners?.();
        },
      };
    } catch (error) {
      options.onTokenChangeError?.(error);
    }
  }
  return {
    status,
    platform: options.platform,
    stop: () => subscription?.remove(),
  };
}

function nativePermissionCall(
  nativeModule: LynxNativeNotificationsModule,
): Promise<boolean> {
  if (nativeModule.requestPermissionAsync)
    return nativeCall(nativeModule.requestPermissionAsync);
  if (
    nativeModule.requestPermission &&
    nativeModule.requestPermission.length > 0
  )
    return nativeCall(nativeModule.requestPermission);
  if (nativeModule.requestPermission)
    return Promise.resolve(
      (nativeModule.requestPermission as unknown as () => boolean)(),
    );
  if (nativeModule.requestPermissionSync)
    return Promise.resolve(nativeModule.requestPermissionSync());
  return Promise.resolve(false);
}

function nativeTokenCall(
  nativeModule: LynxNativeNotificationsModule,
): Promise<string | null> {
  const promise = nativeModule.getTokenAsync
    ? nativeCall(nativeModule.getTokenAsync)
    : nativeModule.getToken && nativeModule.getToken.length > 0
      ? nativeCall(nativeModule.getToken)
      : nativeModule.getToken
        ? Promise.resolve((nativeModule.getToken as unknown as () => string)())
        : Promise.resolve(nativeModule.getTokenSync?.() ?? "");
  return promise.then((token) => token.trim() || null);
}

/** Namespace-style API for pure Lynx applications. */
export const LynxShipNotifications = Object.freeze({
  register: registerLynxPushNotifications,
});

function validateOptions(options: LynxPushRegistrationOptions): void {
  for (const key of [
    "userId",
    "organizationId",
    "projectId",
    "platform",
    "appId",
    "endpoint",
  ] as const) {
    const value = options[key];
    if (typeof value !== "string" || !value.trim())
      throw new NotificationError("INVALID_INPUT", `${key} is required`);
  }
  if (
    options.platform !== "android" &&
    options.platform !== "ios" &&
    options.platform !== "harmony"
  )
    throw new NotificationError(
      "INVALID_INPUT",
      "platform must be android, ios or harmony",
    );
  if (
    typeof options.accessToken !== "string" &&
    typeof options.accessToken !== "function"
  )
    throw new NotificationError("INVALID_INPUT", "accessToken is required");
}
