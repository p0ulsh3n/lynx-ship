# @lynxship/notifications

Secure push-notification and offline-sync primitives for LynxShip.

The default entrypoint is client-safe and can be imported by Lynx:
`@lynxship/notifications`. Server providers and PostgreSQL require the
explicit `@lynxship/notifications/server` entrypoint, so Node-only modules
are never bundled into a mobile Lynx application.

If the server entrypoint is used, install PostgreSQL support explicitly with
`pnpm add pg` (or `npm install pg`). Mobile Lynx and Expo consumers do not
need this optional peer dependency.

```text
Lynx realtime WebSocket       -> messages while the app is active
FCM/APNs provider              -> delivery while the app is backgrounded
Cursor-based sync endpoint    -> messages missed while the app was offline
```

## Included

- `FcmProvider`: official FCM HTTP v1 with a short-lived OAuth 2.0 service
  assertion;
- `ApnsProvider`: official APNs HTTP/2 token-based provider;
- `HuaweiPushProvider`: official Huawei Push Kit v1 provider for HarmonyOS device tokens, authenticated with a short-lived app-level OAuth token;
- `EncryptedPushTokenStore`: AES-256-GCM token encryption and HMAC lookup
  hashes, with no device token in its public snapshot;
- `PostgresPushTokenStore`: persistent version of the encrypted token store;
- `PushService`: tenant-scoped registration, bounded fan-out and permanent
  token invalidation;
- `PushRegistrationClient`: native-token adapter boundary for Lynx, Expo or a
  platform host;
- `@lynxship/notifications/expo`: one-call Expo adapter using the official
  native FCM/APNs token API, permission request and token-rotation listener;
- `@lynxship/notifications/lynx`: pure Lynx `NativeModules` adapter with the
  Android FCM and iOS APNs native bridge exposed through Lynx Autolink;
- `RealtimeCatchUpClient`: authenticated cursor sync that advances only after
  events have been delivered to the application.

The server must authenticate the caller and authorize the target organization,
project and user before calling `PushService`. FCM service-account credentials
and APNs private keys must never reach the Lynx client.

## Expo one-call registration

Install the Expo native notification module at the version selected by the
installed Expo SDK:

```bash
npx expo install expo-notifications expo-constants
```

Then register the native FCM/APNs token with the developer's authenticated
backend:

```ts
import { LynxShipNotifications } from "@lynxship/notifications/expo";

const registration = await LynxShipNotifications.register({
  userId,
  organizationId,
  projectId,
  endpoint: "https://api.example.com/v1/push/registrations",
  accessToken: () => session.accessToken,
});

// Keep this while the app is mounted; call registration.stop() on teardown.
```

The adapter creates the Android channel before obtaining a token, asks the
OS for permission, gets the native FCM/APNs token (not an Expo relay token),
registers it over HTTPS, and re-registers it if the platform rotates it. It
does not return or log the token.

For automatic native build configuration, enable notifications in the
existing `@lynxship/expo` plugin:

```json
{
  "expo": {
    "plugins": [
      [
        "@lynxship/expo",
        {
          "notifications": {
            "enabled": true,
            "enableBackgroundRemoteNotifications": true,
            "communicationNotifications": true,
            "android": { "defaultChannel": "default" }
          }
        }
      ]
    ]
  }
}
```

The plugin delegates to Expo's official `expo-notifications` config plugin,
so `npx expo prebuild`/EAS applies the Android and iOS native changes. A
developer still has to provide FCM/APNs credentials in EAS or CI and the OS
user still has to accept the permission; neither can be safely fabricated by
an npm package.

## Pure Lynx one-call registration

The pure Lynx API is exposed from @lynxship/notifications/lynx. It calls the native module through Lynx NativeModules and uses the same authenticated HTTPS registration contract as the Expo adapter.

Install @lynxship/notifications in the Lynx app and enable Lynx Autolink in the native host once. The package publishes lynx.lib.json, so the Android Gradle Autolink plugin, the iOS cocoapods-lynx-library plugin, and the HarmonyOS Hvigor plugin can discover the native module without per-library registration code.

The call has this shape:

    import { LynxShipNotifications } from "@lynxship/notifications/lynx";
    const registration = await LynxShipNotifications.register({
      userId, organizationId, projectId, platform: "android",
      appId: "com.example.app",
      endpoint: "https://api.example.com/v1/push/registrations",
      accessToken: () => session.accessToken,
    });

Current Lynx documentation exposes Native Modules to Background Thread Scripting, so call this API from the background context. Android uses the host Firebase configuration and FCM. iOS uses APNs and stores the token delivered by the host app delegate.

On iOS, the host must forward the APNs lifecycle token to LynxShipNotificationsStoreAPNsDeviceToken from application:didRegisterForRemoteNotificationsWithDeviceToken:. APNs registration is initiated by the module, but a package cannot safely replace the application's lifecycle callback.

On Android, the package includes the notification permission activity and the FCM token-rotation service. This package targets direct FCM on Android, APNs on iOS, and Huawei Push Kit on HarmonyOS. HarmonyOS is a separate native implementation: it uses the official `pushService.getToken()` API and notification-consent flow, then registers the token with the same HTTPS backend contract. The server provider uses Huawei's OAuth client-credentials flow and standard Push Kit notification/data endpoint; Huawei scenario-specific APIs such as Live View are intentionally not mixed into this generic notification API.

### HarmonyOS setup

The package includes a source HarmonyOS HAR and declares `platforms.harmony` in `lynx.lib.json`. The host must enable `@lynx/lynx-library-plugin` in Hvigor once and provide its own Harmony Lynx runtime. The current official Lynx documentation still marks Harmony Autolink as unavailable in a released Lynx SDK, so the host must use a matching Lynx preview/current release that actually publishes the Hvigor plugin before this path can be compiled. This package does not pretend that a generic Android/iOS build can produce a Harmony HAP.

The host application must also declare `ohos.permission.INTERNET`, enable Push Kit in AppGallery Connect, and use an AppGallery Connect app whose package name and signing identity match the HAP. Huawei notification consent is requested by `LynxShipNotifications.register()`; the user still controls the final choice.

### HarmonyOS server provider

Create the Huawei provider only in the developer's backend, never in Lynx code:

```ts
import {
  HuaweiPushProvider,
  PushService,
} from "@lynxship/notifications/server";

const huawei = new HuaweiPushProvider({
  clientId: process.env.HUAWEI_CLIENT_ID!,
  clientSecret: process.env.HUAWEI_CLIENT_SECRET!,
});

const push = new PushService({ store, providers: [huawei] });
```

`clientId` and `clientSecret` are AppGallery Connect server credentials. Keep
them in a secret manager or CI secret store. The provider caches Huawei's
short-lived OAuth token, sends the standard Push Kit v1 request, and marks
permanently rejected device tokens inactive through `PushService`.

HarmonyOS Push Kit currently exposes token retrieval rather than the Android/iOS-style token-listener API in the public `pushService` contract. The Lynx facade therefore re-reads the token whenever registration runs, normally at app startup. This avoids claiming a callback that the official Harmony API does not provide.

## Native token boundary

For short-lived presence activity outside the app, the server package exports
`createPresenceActivityPushPayload()`. It produces a short-TTL alert with a
stable collapse ID so repeated typing updates do not flood a device. The
application backend must still authorize each recipient and call
`PushService.sendToUser()`; this helper does not broadcast to a group by itself:

    const payload = createPresenceActivityPushPayload({
      eventId,
      conversationId,
      actorId,
      kind: "typing",
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl,
      route: `/messages/${conversationId}`,
    });
    await push.sendToUser({
      userId: recipientId,
      organizationId,
      projectId,
      payload,
    });

For production routing, use `PresenceActivityPushRouter`. The application
backend must first resolve conversation membership and then provide only
authorized recipients. Its required `shouldNotify` policy is where the app
checks notification opt-in and suppresses a recipient who is already viewing
that conversation. The router skips the actor, deduplicates the same
recipient/conversation/actor/kind for 10 seconds by default, bounds fan-out and
uses `PushService` for every registered device:

    const router = new PresenceActivityPushRouter({
      sender: push,
      organizationId,
      projectId,
      shouldNotify: async (recipientId, activity) =>
        await policy.canReceivePresence(recipientId, activity),
    });

    await router.notify({
      eventId,
      conversationId,
      actorId,
      kind: "typing",
      displayName: actor.displayName,
      route: `/messages/${conversationId}`,
      recipientUserIds: authorizedMembers,
    });

The router is intentionally not a membership database and does not infer
privacy permissions. A message or presence gateway should call it only after
authentication, membership checks, user preferences and foreground suppression
have completed. Repeated activity is best-effort and coalesced; do not call it
for every keystroke.

For ordinary messages, use `createMessagePushPayload()` so Android, iOS and
HarmonyOS receive the same bounded identity/routing contract:

    const payload = createMessagePushPayload({
      eventId,
      messageId,
      conversationId,
      actorId: sender.id,
      displayName: sender.displayName,
      avatarUrl: sender.avatarUrl,
      body: message.preview,
      conversationName: conversation.name,
      route: `/messages/${conversationId}`,
    });
    await push.sendToUser({ userId: recipientId, organizationId, projectId, payload });

The message helper includes only a short preview plus IDs in provider data. A
conversation screen should fetch the authoritative message from the
developer's authenticated backend and then mark it read. This prevents a
push payload from becoming a private-data store.

`avatarUrl` is optional and must be an HTTPS URL. Android FCM receives it as
the notification image; HarmonyOS Push Kit receives the official image field.
For iOS, the package includes
`ios/NotificationServiceExtension/LynxShipNotificationService.swift`: add it
to a separate Xcode Notification Service Extension target together with its
`Info.plist`. The main app target must include `INSendMessageIntent` in
`NSUserActivityTypes` and enable the communication-notification capability.
With the Expo integration, setting
`notifications.communicationNotifications` to `true` adds the
`NSUserActivityTypes` entry during prebuild; the capability and extension
target still have to be present in the iOS project.
The extension downloads at most 1 MiB, accepts only HTTPS JPEG/PNG/GIF
responses, adds a `UNNotificationAttachment`, and upgrades the alert with the
sender's `INPerson` avatar when the platform accepts it. It falls back to the
original alert if the download or extension time limit fails.

The extension target is a separate signed bundle and cannot be compiled into
the main Lynx library target. An Expo app must include that target in its iOS
project; `@lynxship/expo` can configure `expo-notifications`, but it cannot
create and sign an arbitrary Xcode extension target from an npm package.
Android rich images work directly through the FCM notification payload. Do not
put private CDN credentials in an image URL.

Use the helper only for a user-visible, opt-in activity policy. Do not send a
push for every keystroke. The app should reconnect realtime and sync the
authoritative conversation state after opening the notification.

Android FCM and iOS APNs issue native device tokens. This package intentionally
does not invent a second notification provider. An Expo host can use the
`/expo` adapter above, while a pure Lynx host uses the `/lynx` adapter. Both
register the native token with the backend over HTTPS and re-register when the
platform rotates it. The server providers remain in the `/server` entrypoint.

## Security contract

- use HTTPS/WSS in production and credentials in headers, never URLs;
- keep provider credentials in a secret manager or CI secret store;
- use separate APNs development and production credentials/topics;
- enforce organization/project ownership before registering or sending;
- keep payloads small and avoid putting private message content in push data;
- treat push delivery as best effort and recover authoritative data through an
  authenticated cursor-sync endpoint;
- expire or revoke registrations and disable permanently rejected tokens;
- never log access tokens, private keys, device tokens or full provider URLs.

Background delivery is not guaranteed. Android can terminate background work,
and Apple can throttle or coalesce background notifications. A push is a
wake-up or user-attention signal; the sync endpoint remains the source of
truth. This package does not implement audio, video, VoIP or WebRTC.

## Official sources checked on 2026-08-28

- [FCM HTTP v1 API](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
- [FCM Android message handling](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)
- [Registering with APNs](https://developer.apple.com/documentation/UserNotifications/registering-your-app-with-apns)
- [Sending APNs requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
- [Apple background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
- [Expo notifications API](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo config plugins](https://docs.expo.dev/config-plugins/plugins/)
- [Lynx native libraries and Autolink](https://lynxjs.org/next/guide/autolink.html)
- [Lynx native modules](https://lynxjs.org/next/guide/use-native-modules.html?platform=harmony)
- [HarmonyOS Push Kit token API](https://developer.huawei.com/consumer/en/doc/harmonyos-references-V13/push-pushservice-V13)
- [HarmonyOS notification permission API](https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V13/js-apis-notificationmanager-V13)
- [Huawei Push Kit OAuth app-level credential](https://developer.huawei.com/consumer/en/doc/harmonyos-references/account-api-obtain-app-token)
- [Huawei Push Kit downlink message contract](https://developer.huawei.com/consumer/en/doc/HMScore-Guides/multisender-0000001057626308)
