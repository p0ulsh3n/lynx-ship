import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EncryptedPushTokenStore,
  FcmProvider,
  HuaweiPushProvider,
  NotificationError,
  PresenceActivityPushRouter,
  RealtimeCatchUpClient,
  PushService,
  createPresenceActivityPushPayload,
  createMessagePushPayload,
  type PushProvider,
} from "@lynxship/notifications/server";
import {
  LynxShipNotifications,
  createExpoPushAdapter,
  createHttpRegisterDeviceTransport,
} from "@lynxship/notifications/expo";
import { LynxShipNotifications as LynxNativeNotifications } from "@lynxship/notifications/lynx";
import { PushRegistrationClient } from "@lynxship/notifications/client";

const notificationsPackageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/notifications",
);

const destination = {
  userId: "user-1",
  organizationId: "org-1",
  projectId: "project-1",
  platform: "android" as const,
  appId: "com.example.app",
  environment: "production" as const,
  token: "fcm-device-token",
};

test("encrypts device tokens and never exposes them in snapshots", async () => {
  const store = new EncryptedPushTokenStore("test-master-key");
  const record = await store.register(destination);
  assert.equal("token" in record, false);
  assert.notEqual(record.tokenHash, destination.token);
  assert.equal(
    (await store.listActive(destination))[0]?.token,
    destination.token,
  );
  await store.disable(record.id);
  assert.equal((await store.listActive(destination)).length, 0);
});

test("presence push payloads are short-lived and coalescible", () => {
  const payload = createPresenceActivityPushPayload({
    eventId: "event-1",
    conversationId: "chat-1",
    actorId: "user-2",
    kind: "typing",
    displayName: "Alice",
    avatarUrl: "https://cdn.example.com/avatars/user-2.png",
    route: "/messages/chat-1",
  });
  assert.equal(payload.kind, "alert");
  assert.equal(payload.title, "Alice");
  assert.equal(payload.body, "is typing");
  assert.equal(payload.imageUrl, "https://cdn.example.com/avatars/user-2.png");
  assert.equal(payload.ttlSeconds, 10);
  assert.match(payload.collapseId ?? "", /^presence-[a-f0-9]{32}$/);
  assert.deepEqual(payload.data, {
    type: "presence.activity",
    eventId: "event-1",
    conversationId: "chat-1",
    actorId: "user-2",
    kind: "typing",
    route: "/messages/chat-1",
  });
  assert.throws(
    () =>
      createPresenceActivityPushPayload({
        eventId: "event-1",
        conversationId: "chat-1",
        actorId: "user-2",
        kind: "typing",
        displayName: "Alice",
        avatarUrl: "http://cdn.example.com/avatar.png",
        route: "/messages/chat-1",
      }),
    (error: unknown) =>
      error instanceof NotificationError && error.code === "INVALID_URL",
  );
  assert.throws(
    () =>
      createPresenceActivityPushPayload({
        eventId: "event-1",
        conversationId: "chat-1",
        actorId: "user-2",
        kind: "typing",
        displayName: "Alice\nunsafe",
        route: "/messages/chat-1",
      }),
    (error: unknown) =>
      error instanceof NotificationError && error.code === "INVALID_INPUT",
  );
});

test("message push payload carries conversation identity for rich notifications", () => {
  const payload = createMessagePushPayload({
    eventId: "event-message-1",
    messageId: "message-1",
    conversationId: "conversation-1",
    actorId: "user-2",
    displayName: "Alice",
    avatarUrl: "https://cdn.example.com/avatars/user-2.png",
    body: "Hello from the conversation",
    conversationName: "LynxShip team",
    route: "/messages/conversation-1",
  });
  assert.equal(payload.title, "Alice");
  assert.equal(payload.subtitle, "LynxShip team");
  assert.equal(payload.body, "Hello from the conversation");
  assert.equal(payload.imageUrl, "https://cdn.example.com/avatars/user-2.png");
  assert.match(payload.threadId ?? "", /^conversation-[a-f0-9]{32}$/);
  assert.deepEqual(payload.data, {
    type: "chat.message",
    eventId: "event-message-1",
    messageId: "message-1",
    conversationId: "conversation-1",
    actorId: "user-2",
    route: "/messages/conversation-1",
  });
  assert.doesNotThrow(() =>
    createMessagePushPayload({
      eventId: "event-message-1",
      messageId: "message-1",
      conversationId: "conversation-1",
      actorId: "user-2",
      displayName: "Alice",
      body: "Hello",
      route: "/messages/conversation-1",
    }),
  );
});

test("presence push router applies recipient policy and deduplicates activity", async () => {
  let now = 1_777_000_000_000;
  const sent: string[] = [];
  const router = new PresenceActivityPushRouter({
    sender: {
      async sendToUser(input) {
        sent.push(input.userId);
        return {
          attempted: 1,
          accepted: 1,
          disabled: 0,
          failures: [],
        };
      },
    },
    organizationId: "org-1",
    projectId: "project-1",
    now: () => now,
    shouldNotify: async (recipientId) => recipientId !== "muted-user",
  });
  const request = {
    eventId: "event-1",
    conversationId: "conversation-1",
    actorId: "actor-1",
    kind: "typing" as const,
    displayName: "Alice",
    route: "/messages/conversation-1",
    recipientUserIds: ["actor-1", "recipient-1", "muted-user", "recipient-1"],
  };

  const first = await router.notify(request);
  assert.deepEqual(sent, ["recipient-1"]);
  assert.equal(first.attemptedRecipients, 1);
  assert.equal(first.skippedRecipients, 2);
  assert.equal(first.acceptedDevices, 1);

  now += 1_000;
  const duplicate = await router.notify({ ...request, eventId: "event-2" });
  assert.equal(duplicate.attemptedRecipients, 0);
  assert.equal(duplicate.skippedRecipients, 3);
  assert.deepEqual(sent, ["recipient-1"]);

  now += 10_000;
  const afterWindow = await router.notify({ ...request, eventId: "event-3" });
  assert.equal(afterWindow.attemptedRecipients, 1);
  assert.deepEqual(sent, ["recipient-1", "recipient-1"]);
  router.clear();
});

test("FCM authenticates with a short-lived OAuth assertion and sends a payload", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    requests.push({ url, body });
    if (url === "https://oauth2.googleapis.com/token")
      return new Response(
        JSON.stringify({ access_token: "short-lived", expires_in: 3600 }),
        { status: 200 },
      );
    return new Response(JSON.stringify({ name: "projects/p/messages/1" }), {
      status: 200,
    });
  };
  const provider = new FcmProvider(
    {
      projectId: "firebase-project",
      clientEmail: "server@example.iam.gserviceaccount.com",
      privateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    },
    { fetch: fetchImpl },
  );
  await provider.send({
    destination: { id: "destination-1", ...destination },
    payload: {
      title: "New message",
      body: "Hello",
      imageUrl: "https://cdn.example.com/avatars/user-2.png",
      data: { eventId: "evt-1" },
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, "https://oauth2.googleapis.com/token");
  assert.match(requests[1]?.body ?? "", /fcm-device-token/);
  assert.match(
    requests[1]?.body ?? "",
    /https:\/\/cdn\.example\.com\/avatars\/user-2\.png/,
  );
  assert.doesNotMatch(requests[1]?.body ?? "", /short-lived/);
});

test("Huawei Push Kit authenticates and sends a HarmonyOS notification payload", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    requests.push({ url, body });
    if (url === "https://oauth-login.cloud.huawei.com/oauth2/v3/token")
      return new Response(
        JSON.stringify({
          access_token: "huawei-short-lived",
          expires_in: 3600,
        }),
        { status: 200 },
      );
    return new Response(
      JSON.stringify({ code: "80000000", requestId: "hw-request-1" }),
      { status: 200 },
    );
  };
  const provider = new HuaweiPushProvider(
    { clientId: "huawei-client", clientSecret: "server-secret" },
    { fetch: fetchImpl },
  );
  const result = await provider.send({
    destination: {
      id: "destination-harmony-1",
      ...destination,
      platform: "harmony",
      token: "harmony-push-token",
    },
    payload: {
      title: "New message",
      body: "Hello from Huawei",
      imageUrl: "https://cdn.example.com/avatars/user-2.png",
      data: { eventId: "evt-harmony-1" },
    },
  });
  assert.equal(result.provider, "huawei");
  assert.equal(result.providerMessageId, "hw-request-1");
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0]?.url,
    "https://oauth-login.cloud.huawei.com/oauth2/v3/token",
  );
  assert.equal(
    requests[1]?.url,
    "https://push-api.cloud.huawei.com/v1/huawei-client/messages:send",
  );
  assert.match(requests[1]?.body ?? "", /harmony-push-token/);
  assert.match(
    requests[1]?.body ?? "",
    /https:\/\/cdn\.example\.com\/avatars\/user-2\.png/,
  );
  assert.doesNotMatch(
    requests[1]?.body ?? "",
    /server-secret|huawei-short-lived/,
  );
});

test("Huawei only marks an explicitly invalid token as permanently rejected", async () => {
  let pushRequest = false;
  const provider = new HuaweiPushProvider(
    { clientId: "huawei-client", clientSecret: "server-secret" },
    {
      fetch: async (input) => {
        if (String(input).includes("oauth-login"))
          return new Response(
            JSON.stringify({ access_token: "short-lived", expires_in: 3600 }),
            { status: 200 },
          );
        pushRequest = true;
        return new Response(JSON.stringify({ code: "80300007" }), {
          status: 200,
        });
      },
    },
  );
  await assert.rejects(
    provider.send({
      destination: {
        id: "destination-harmony-1",
        ...destination,
        platform: "harmony",
        token: "invalid-harmony-token",
      },
      payload: { title: "Hello" },
    }),
    (error: unknown) =>
      error instanceof NotificationError &&
      error.code === "PROVIDER_REJECTED" &&
      error.permanent === true,
  );
  assert.equal(pushRequest, true);
});

test("permanently rejected destinations are disabled by PushService", async () => {
  const store = new EncryptedPushTokenStore("test-master-key");
  const record = await store.register(destination);
  const provider: PushProvider = {
    name: "fcm",
    platform: "android",
    async send() {
      throw new NotificationError(
        "PROVIDER_REJECTED",
        "provider rejected token",
        {
          permanent: true,
        },
      );
    },
  };
  const result = await new PushService({
    store,
    providers: [provider],
  }).sendToUser({
    userId: destination.userId,
    organizationId: destination.organizationId,
    projectId: destination.projectId,
    payload: { title: "Hi" },
  });
  assert.equal(result.disabled, 1);
  assert.equal(result.accepted, 0);
  assert.equal((await store.listActive(destination)).length, 0);
  assert.equal(result.failures[0]?.destinationId, record.id);
});

test("registration refuses permission without sending a token", async () => {
  let calls = 0;
  const result = await new PushRegistrationClient(
    {
      platform: "ios",
      appId: "com.example.app",
      environment: "production",
      requestPermission: async () => false,
      getToken: async () => "deadbeef",
    },
    {
      register: async () => {
        calls += 1;
      },
    },
    {
      userId: "user-1",
      organizationId: "org-1",
      projectId: "project-1",
    },
  ).register();
  assert.equal(result, "permission-denied");
  assert.equal(calls, 0);
});

test("Expo adapter creates the Android channel and registers the native token", async () => {
  let channelCreated = false;
  let permissionRequests = 0;
  let registered: Record<string, unknown> | undefined;
  let tokenListener:
    | ((token: { type: string; data: string }) => void)
    | undefined;
  const notifications = {
    async setNotificationChannelAsync() {
      channelCreated = true;
    },
    async getPermissionsAsync() {
      return { granted: false };
    },
    async requestPermissionsAsync() {
      permissionRequests += 1;
      return { granted: true };
    },
    async getDevicePushTokenAsync() {
      return { type: "fcm", data: "native-fcm-token" };
    },
    addPushTokenListener(
      listener: (token: { type: string; data: string }) => void,
    ) {
      tokenListener = listener;
      return { remove() {} };
    },
  };
  const transport = createHttpRegisterDeviceTransport({
    endpoint: "https://api.example.com/v1/push/registrations",
    accessToken: "session-token",
    fetch: async (_input, init) => {
      registered = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    },
  });
  const adapter = await createExpoPushAdapter({
    platform: "android",
    appId: "com.example.app",
    notifications,
    reactNative: { Platform: { OS: "android" } },
  });
  const result = await new PushRegistrationClient(adapter, transport, {
    userId: "user-1",
    organizationId: "org-1",
    projectId: "project-1",
  }).register();
  assert.equal(result, "registered");
  assert.equal(channelCreated, true);
  assert.equal(permissionRequests, 1);
  assert.equal(registered?.token, "native-fcm-token");
  assert.equal(registered?.platform, "android");
  const subscription = adapter.onTokenChange?.(() => undefined);
  assert.equal(typeof tokenListener, "function");
  subscription?.remove();
});

test("Expo registration validates HTTPS and tracks token rotations without exposing tokens", async () => {
  const requests: string[] = [];
  let removed = false;
  let tokenListener:
    | ((token: { type: string; data: string }) => void)
    | undefined;
  const result = await LynxShipNotifications.register({
    userId: "user-1",
    organizationId: "org-1",
    projectId: "project-1",
    endpoint: "https://api.example.com/v1/push/registrations",
    accessToken: () => "rotating-session-token",
    platform: "ios",
    appId: "com.example.app",
    notifications: {
      async getPermissionsAsync() {
        return { granted: true };
      },
      async requestPermissionsAsync() {
        return { granted: true };
      },
      async getDevicePushTokenAsync() {
        return { type: "apns", data: new Uint8Array([0xab, 0xcd]) };
      },
      addPushTokenListener(
        listener: (token: { type: string; data: string }) => void,
      ) {
        tokenListener = listener;
        return { remove: () => (removed = true) };
      },
    },
    reactNative: { Platform: { OS: "ios" } },
    fetch: async (_input, init) => {
      requests.push(String(init?.body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(result.status, "registered");
  assert.equal(result.platform, "ios");
  assert.match(requests[0] ?? "", /abcd/);
  assert.doesNotMatch(requests[0] ?? "", /rotating-session-token/);
  tokenListener?.({ type: "apns", data: "new-token" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  result.stop();
  assert.equal(removed, true);
  assert.throws(
    () =>
      createHttpRegisterDeviceTransport({
        endpoint: "http://evil.example.com",
        accessToken: "x",
      }),
    /https/,
  );
});

test("pure Lynx registration uses NativeModules and handles token rotation", async () => {
  const requests: string[] = [];
  let tokenListener: ((token: string) => void) | undefined;
  let cleared = false;
  const result = await LynxNativeNotifications.register({
    userId: "user-1",
    organizationId: "org-1",
    projectId: "project-1",
    platform: "android",
    appId: "com.example.app",
    endpoint: "https://api.example.com/v1/push/registrations",
    accessToken: "session-token",
    nativeModule: {
      requestPermission: (callback) => callback(true),
      getToken: (callback) => callback("initial-fcm-token"),
      subscribeTokenChanges: (callback) => {
        tokenListener = callback;
      },
      clearTokenChangeListeners: () => {
        cleared = true;
      },
    },
    fetch: async (_input, init) => {
      requests.push(String(init?.body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(result.status, "registered");
  assert.equal(requests.length, 1);
  assert.match(requests[0] ?? "", /initial-fcm-token/);
  tokenListener?.("rotated-fcm-token");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.match(requests[1] ?? "", /rotated-fcm-token/);
  result.stop();
  assert.equal(cleared, true);
});

test("pure Lynx registration supports the asynchronous HarmonyOS bridge", async () => {
  let registered: Record<string, unknown> | undefined;
  const result = await LynxNativeNotifications.register({
    userId: "user-1",
    organizationId: "org-1",
    projectId: "project-1",
    platform: "harmony",
    appId: "com.example.harmony",
    endpoint: "https://api.example.com/v1/push/registrations",
    accessToken: "session-token",
    nativeModule: {
      requestPermissionAsync: (callback) => callback(true),
      getTokenAsync: (callback) => callback("harmony-push-token"),
    },
    fetch: async (_input, init) => {
      registered = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(result.status, "registered");
  assert.equal(result.platform, "harmony");
  assert.equal(registered?.platform, "harmony");
  assert.equal(registered?.token, "harmony-push-token");
});

test("pure Lynx package publishes a complete Autolink contract", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(notificationsPackageRoot, "lynx.lib.json"), "utf8"),
  ) as {
    platforms?: {
      android?: { packageName?: string; sourceDir?: string };
      ios?: { sourceDir?: string; podspecPath?: string };
      harmony?: { packageDir?: string };
    };
  };
  assert.equal(
    manifest.platforms?.android?.packageName,
    "com.lynxship.notifications",
  );
  assert.equal(manifest.platforms?.android?.sourceDir, "android");
  assert.equal(manifest.platforms?.ios?.sourceDir, "ios");
  assert.equal(
    manifest.platforms?.ios?.podspecPath,
    "ios/lynxship-notifications.podspec",
  );
  assert.equal(manifest.platforms?.harmony?.packageDir, "harmony");
  const [
    androidSource,
    iosSource,
    harmonyManifest,
    harmonyProvider,
    harmonyModule,
  ] = await Promise.all([
    readFile(
      resolve(
        notificationsPackageRoot,
        "android/src/main/java/com/lynxship/notifications/LynxShipNotificationsModule.java",
      ),
      "utf8",
    ),
    readFile(
      resolve(notificationsPackageRoot, "ios/LynxShipNotificationsModule.h"),
      "utf8",
    ),
    readFile(
      resolve(notificationsPackageRoot, "harmony/src/main/module.json5"),
      "utf8",
    ),
    readFile(
      resolve(
        notificationsPackageRoot,
        "harmony/src/main/ets/LynxLibraryProviderImpl.ets",
      ),
      "utf8",
    ),
    readFile(
      resolve(
        notificationsPackageRoot,
        "harmony/src/main/ets/LynxShipNotificationsModule.ets",
      ),
      "utf8",
    ),
  ]);
  assert.match(
    androidSource,
    /@LynxNativeModule\(name = "LynxShipNotifications"\)/,
  );
  assert.match(iosSource, /@LynxNativeModule\("LynxShipNotifications"\)/);
  assert.match(harmonyManifest, /ohos\.permission\.INTERNET/);
  assert.match(harmonyProvider, /LynxLibraryProviderImpl/);
  assert.match(harmonyProvider, /registerModule\('LynxShipNotifications'/);
  assert.match(harmonyModule, /pushService\.getToken/);
  assert.match(harmonyModule, /requestEnableNotification/);
});

test("iOS rich notification extension is publishable and isolated from the main pod", async () => {
  const [service, info, podspec] = await Promise.all([
    readFile(
      resolve(
        notificationsPackageRoot,
        "ios/NotificationServiceExtension/LynxShipNotificationService.swift",
      ),
      "utf8",
    ),
    readFile(
      resolve(
        notificationsPackageRoot,
        "ios/NotificationServiceExtension/Info.plist",
      ),
      "utf8",
    ),
    readFile(
      resolve(notificationsPackageRoot, "ios/lynxship-notifications.podspec"),
      "utf8",
    ),
  ]);
  assert.match(service, /UNNotificationServiceExtension/);
  assert.match(service, /INSendMessageIntent/);
  assert.match(service, /INPerson/);
  assert.match(service, /1_048_576/);
  assert.match(service, /https/);
  assert.match(info, /com\.apple\.usernotifications\.service/);
  assert.match(info, /LynxShipNotificationService/);
  assert.match(podspec, /exclude_files.*NotificationServiceExtension/);
});

test("catch-up persists a cursor only after each page is applied", async () => {
  let cursor: string | null = "cursor-0";
  const requests: string[] = [];
  const client = new RealtimeCatchUpClient({
    endpoint: "https://api.example.com/v1/realtime/sync",
    token: "access-token",
    cursorStore: {
      get: async () => cursor,
      set: async (next) => {
        cursor = next;
      },
    },
    fetch: async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          events: [
            {
              id: "event-1",
              type: "chat.message",
              ts: 1777000000000,
              payload: { text: "hello" },
            },
          ],
          nextCursor: null,
        }),
        { status: 200 },
      );
    },
  });
  const events: string[] = [];
  const processed = await client.sync((event) => {
    events.push(event.id);
  });
  assert.equal(processed, 1);
  assert.deepEqual(events, ["event-1"]);
  assert.equal(cursor, "cursor-0");
  assert.match(requests[0] ?? "", /after=cursor-0/);
});
