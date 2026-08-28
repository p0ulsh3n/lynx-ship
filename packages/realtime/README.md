# @lynxship/lynx-realtime

Secure, bounded real-time messaging for Lynx applications.

This package is intentionally a protocol client, not a new WebSocket engine.
On Lynx, it uses the official `@lynx-js/websocket` implementation, which
delegates socket transport to the integrated Lynx runtime. On web or tests, a
standard or injected WebSocket implementation can be used.

It is designed for chat, live comments, presence, reactions, notifications,
build progress and other JSON event streams. It does not implement audio,
video, camera, microphone or WebRTC.

## Usage

```ts
import { createRealtimeClient } from "@lynxship/lynx-realtime";

const realtime = createRealtimeClient({
  url: "wss://api.example.com/realtime",
  token: async () => getShortLivedAccessToken(),
  onMessage: (message) => {
    if (message.type === "chat.message") {
      updateConversation(message.payload);
    }
  },
  onError: (error) => {
    console.warn(error.code, error.message);
  },
});

await realtime.connect();
realtime.send("chat.message", {
  conversationId: "conversation-1",
  text: "Hello",
});

// Call this when the screen or host is permanently closed.
realtime.close();
```

Messages use a versioned envelope:

```json
{
  "v": 1,
  "type": "chat.message",
  "id": "message-id",
  "ts": 1777000000000,
  "payload": { "text": "Hello" }
}
```

The client authenticates with a short-lived token in the first application
frame, never in the URL. It does not persist tokens or include them in error
messages. The server must reject application frames until authentication is
accepted.

## Optional typing and recording presence

Use the optional presence facade for ephemeral conversation state. It sends one
transition when a state changes, debounces typing inactivity, refreshes active
states while the socket is alive, and clears local states when the app enters
the background.

Example:

    import { createPresenceClient } from "@lynxship/lynx-realtime";

    const presence = createPresenceClient({
      url: "wss://api.example.com/realtime",
      token: () => getShortLivedAccessToken(),
      onEvent: (event) => {
        if (event.kind === "typing") showTyping(event.userId, event.active);
        if (event.kind === "recording") showRecording(event.userId, event.active);
      },
    });

    await presence.connect();
    presence.noteTyping("conversation-1"); // input text-change handler
    presence.stopTyping("conversation-1"); // submit, blur or unmount
    presence.startRecording("conversation-1");
    presence.stopRecording("conversation-1");
    await presence.setAppState("background");
    await presence.setAppState("active");

For group conversations, call presence.getConversation("group-1"). The
returned typing and recording arrays contain one participant per user and kind,
so Alice typing and Bob recording can be shown at the same time. The store
deduplicates repeated events, expires stale users, enforces a participant
limit, and keeps typing separate from recording.

Load profile data from the application's authenticated profile endpoint and
put it in the store:

    presence.setProfile("user-2", {
      displayName: "Alice",
      avatarUrl: "https://cdn.example.com/avatar/user-2.png",
    });

Presence frames carry only userId. The profile is copied into
getConversation() results without being sent on every keystroke. Only HTTPS
avatar URLs without embedded credentials are accepted.

The backend can update that cache while the socket stays connected by sending
a `profile.updated` application event. The client validates it, updates every
active conversation snapshot and calls `onProfileChange`. A profile update does
not require a reconnect. If the app receives no profile event, it should
refresh the profile endpoint during its normal authenticated sync.

### Foreground activity notifications

When the app is open but the user is viewing another screen, attach an
`activityNotifications` handler. It emits a bounded and deduplicated callback
for each remote typing or recording transition, including the conversation ID
and cached profile. The host can render a banner, inbox item or stack of
banners and suppress the conversation currently visible on screen:

    const presence = createPresenceClient({
      url: "wss://api.example.com/realtime",
      token: () => getShortLivedAccessToken(),
      activityNotifications: {
        selfUserId: currentUserId,
        shouldNotify: (event) => event.conversationId !== visibleConversationId,
        onNotification: (activity) => activityInbox.add(activity),
      },
    });

Each conversation and participant is tracked independently, so simultaneous
activity in different conversations can be displayed separately. This callback
does not create an operating-system notification and does not keep a socket
alive in the background.

For a reusable Snapchat-style top banner layout, use the headless
`PresenceActivityStack`. It keeps one current item per conversation, participant
and activity kind, expires stale cards, bounds memory, and returns top-first
`offsetY`, `scale`, `opacity` and `zIndex` values. The application owns the
actual card, typography, avatar, colors, gestures and accessibility text. For
the standard avatar-left design, the package also provides a ReactLynx layer;
the headless API remains available for completely custom renderers:

    import {
      PresenceActivityStack,
      createPresenceClient,
    } from "@lynxship/lynx-realtime";

    const activityStack = new PresenceActivityStack({
      maxVisible: 3,
      overlapPx: 10,
      onChange: (snapshot) => setActivityBanners(snapshot.visible),
    });

    const presence = createPresenceClient({
      url: "wss://api.example.com/realtime",
      token: () => getShortLivedAccessToken(),
      activityNotifications: {
        selfUserId: currentUserId,
        onNotification: (activity) => activityStack.push(activity),
      },
    });

    // In the app's renderer, map each entry to your own <view> card:
    // transform: `translateY(${entry.offsetY}px) scale(${entry.scale})`,
    // opacity: entry.opacity, zIndex: entry.zIndex.

The ready-to-use ReactLynx component has no application logo. It places the
avatar on the left, the display name and body on the right, stacks up to three
cards at the top, and expires them automatically:

    import {
      ActivityBannerLayer,
      useActivityStack,
    } from "@lynxship/lynx-realtime/react-lynx-banners";
    import type { ActivityBannerItem } from "@lynxship/lynx-realtime/react-lynx-banners";

    type Banner = ActivityBannerItem & { userId: string; kind: "typing" | "recording" };
    const { stack, snapshot } = useActivityStack<Banner>({
      maxVisible: 3,
      overlapPx: 10,
    });

    // Pass the host's safe-area top inset when it is available.
    return (
      <ActivityBannerLayer
        snapshot={snapshot}
        topInset={safeAreaTop + 12}
        onPress={(item) => navigate(`/messages/${item.conversationId}`)}
      />
    );

    // When a notification arrives:
    // stack.push({
    //   ...activity,
    //   avatarUrl: activity.profile?.avatarUrl,
    //   isLive: activity.kind === "live",
    //   liveRingColor: "#ff3b81",
    //   liveRingWidth: 2,
    // });

The standard layer supports an optional live indicator without imposing a
visual style on the application. Set `isLive: true` only for a live activity
to render a pulsing ring around the left-hand avatar. Set `liveRingColor` and
`liveRingWidth` per item to choose its color and thickness. Typing, recording,
message and other non-live banners have no ring. The `theme` prop lets the
application override the layer, card, avatar, title and body styles, including
backgrounds, borders, text colors, spacing and typography. The
animation uses Lynx-supported `transform` and `opacity` properties, and the
stylesheet is included in the published package automatically.

There is no close button in the ready-to-use banner. Entries disappear when
the stack TTL expires; application code can still call `stack.dismiss(key)`
when navigation or a custom gesture requires immediate removal.

Tailwind users can provide utility classes for every visual part. Set
`unstyled` to remove the component's default inline design, then provide the
layout and appearance with `classNames`:

    <ActivityBannerLayer
      snapshot={snapshot}
      unstyled
      classNames={{
        layer: "fixed left-4 right-4 top-4 z-50",
        card: "linear linear-row items-center rounded-2xl bg-slate-900 p-3",
        avatarSlot: "mr-3",
        avatar: "h-11 w-11 rounded-full",
        content: "linear-1",
        title: "text-white text-base font-semibold",
        body: "mt-1 text-slate-300 text-sm",
        liveRing: "rounded-full",
      }}
    />

The component still applies only the live ring's dynamic color and thickness
from `liveRingColor` and `liveRingWidth`; all other design values can be
owned by Tailwind classes or the `theme` prop.

Importing this subpath is intentionally separate from the default package
entrypoint so Node/server code does not load the ReactLynx runtime. Developers
who need a different visual design can continue mapping `snapshot.visible`
themselves.

Use the generic `ActivityStack` for incoming messages and other app-defined
banners. Give each message its own `id` if every message should appear, or
provide a custom `keyOf` when updates should replace an existing card:

    type MessageBanner = {
      id: string;
      conversationId: string;
      createdAt: number;
      title: string;
      body: string;
      kind: "message";
    };

    const banners = new ActivityStack<MessageBanner>({
      keyOf: (message) => message.id,
      onChange: (snapshot) => setActivityBanners(snapshot.visible),
    });

    realtime.subscribe((message) => {
      if (message.type !== "chat.message") return;
      const payload = message.payload as {
        id: string;
        conversationId: string;
        senderName: string;
        text: string;
      };
      if (payload.conversationId === visibleConversationId) return;
      banners.push({
        id: payload.id,
        conversationId: payload.conversationId,
        createdAt: Date.now(),
        title: payload.senderName,
        body: payload.text,
        kind: "message",
      });
    });

Messages, typing and recording can therefore use the same top overlay, while
each application still chooses whether to show text, an avatar, a call-to-
action or a compact `+N` card. The server must still authorize message
visibility; the client should never turn an untrusted event into a private
preview without applying the application's policy.

Use a fixed top overlay with the host's safe-area inset and a supported Lynx
transition on `transform` and `opacity` (for example, 200–260 ms). Do not
hard-code the card design into the realtime package. Two-person and group
conversations use the same model; simultaneous users remain separate entries,
and `overflowCount` lets the app render a compact “+N” indicator instead of
letting banners grow without bound. This is the same interaction pattern as a
stacked social notification surface, not a claim about Snapchat's private
implementation details.

noteTyping emits presence.typing once, then emits the stop transition after
2.5 seconds without another call. startTyping and stopTyping are available
when the host already knows the exact transitions. Recording states remain
active until stopped, the app backgrounds, the client closes, or the
server-side presence TTL expires. The default limit is 64 active conversation
states per client.

The client accepts only server events with this shape:

    {
      "v": 1,
      "type": "presence.changed",
      "payload": {
        "conversationId": "conversation-1",
        "userId": "user-2",
        "kind": "typing",
        "active": true,
        "expiresAt": 1777000000100
      }
    }

The server must derive userId from the authenticated session, check
conversation membership for every event, rate-limit and debounce senders, and
store presence only as short-lived state. It should expire typing and
recording entries even when a client crashes, and treat the client heartbeat
as a refresh hint rather than proof of authorization. Never put message text,
access tokens or audio data in presence frames.

## Read and delivery receipts

Use `createReadReceiptClient` for delivery and read state. It sends
`message.delivered` and `message.read` without a userId; the server derives the
actor from the authenticated session. The server broadcasts one
`message.receipt.changed` event per authorized participant:

    {
      "v": 1,
      "type": "message.receipt.changed",
      "payload": {
        "conversationId": "conversation-1",
        "messageId": "message-42",
        "userId": "user-2",
        "kind": "read",
        "occurredAt": 1777000000100
      }
    }

The store upgrades `delivered` to `read`, rejects stale or malformed events,
and exposes sorted `readBy`/`deliveredBy` arrays. A group UI can show the exact
readers or only a count. The server remains authoritative: it must check
conversation membership, make receipt writes idempotent, enforce message
visibility, rate-limit clients, and provide cursor-based catch-up after an
offline period. Never trust a client-supplied userId.

## Activity outside the current conversation

While the app is foregrounded, use `activityNotifications` for in-app banners
even when the user is on another screen. While the app is backgrounded or
closed, the presence WebSocket is not a delivery channel. The developer's
backend should coalesce short-lived activity and optionally send an alert push
through `@lynxship/notifications/server` to registered devices. Use a short
TTL and a conversation/user/kind collapse ID; do not send every keystroke.
Keep private content on the authenticated sync API and send only a stable event
ID, conversation ID, actor ID and route in the push data. On resume, reconnect
realtime and perform cursor sync.

Android conversation notifications can use `MessagingStyle`, `Person`,
conversation shortcuts and optional bubbles. Apple communication notifications
can provide sender/group context and avatars. The operating system still
controls permission, throttling and presentation, so a delayed or omitted
presence push must not corrupt the conversation state.

closeOnBackground defaults to true: the facade stops ephemeral states and
closes its socket when the app is backgrounded, then reconnects when it becomes
active again. Android and iOS can suspend or terminate background JavaScript,
so a WebSocket is not a guaranteed background delivery channel. Use
@lynxship/notifications for real message notifications and cursor-based sync
when the app resumes. This package does not implement audio, microphone,
video, VoIP or system overlays.

The presence facade is intentionally transport- and host-lifecycle agnostic.
Use bindLifecycle({ subscribe(listener) { ... } }) when an app has a native or
framework lifecycle source. Do not assume that a Lynx UI timer can run while
its host process is suspended.

## Security contract

The client enforces the following defaults:

- `wss://` is required; insecure `ws://` is limited to local development hosts;
- credentials in URL query strings, usernames or passwords are rejected;
- JSON-only text frames are accepted, with a 64 KiB default frame limit;
- payloads are checked for JSON values, finite numbers and bounded nesting;
- outbound messages use a bounded queue rather than unbounded memory growth;
- application message types are allow-list-shaped and reserved control types are
  inaccessible to callers;
- authentication happens before queued application messages are flushed;
- heartbeat timeouts close dead connections;
- reconnect attempts use exponential backoff with jitter and a finite default;
- errors contain codes but never tokens or complete message payloads.

This is not a replacement for server security. A production server must still
use TLS, authenticate and authorize every action, validate every payload, limit
connections and message rates, enforce maximum payload sizes, expire sessions,
handle replay/idempotency, log security events without secrets, and validate
browser origins where applicable. Use push notifications such as FCM/APNs for
background delivery instead of keeping an unrestricted socket alive forever.

## Platform boundary

The package does not require a `lynx.lib.json` native library because it uses
the official Lynx WebSocket runtime capability. If a future platform needs a
custom transport, inject `createSocket` or publish a separate Lynx Native
Library with the official `lynx.lib.json` and Autolink contract. LynxShip can
then discover and build that library without putting platform-specific socket
code in the Lynx UI bundle.
