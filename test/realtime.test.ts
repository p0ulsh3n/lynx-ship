import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

import {
  RealtimeError,
  ActivityStack,
  createPresenceClient,
  createReadReceiptClient,
  createRealtimeClient,
  PresenceActivityStack,
  PresenceActivityNotifier,
  PresenceStateStore,
  type RealtimeSocket,
} from "@lynxship/lynx-realtime";

function activity(
  id: string,
  conversationId: string,
  userId: string,
  kind: "typing" | "recording" = "typing",
  createdAt = 1_777_000_000_000,
) {
  return {
    id,
    conversationId,
    userId,
    kind,
    title: `${userId} is ${kind}`,
    body: `${userId} is ${kind}`,
    createdAt,
  } as const;
}

class FakeSocket implements RealtimeSocket {
  static instances: FakeSocket[] = [];

  readonly readyState = 0;

  onopen: ((event: unknown) => void) | null = null;

  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;

  onerror: ((event: { message?: string }) => void) | null = null;

  onclose:
    | ((event: { code: number; reason: string; wasClean: boolean }) => void)
    | null = null;

  readonly sent: string[] = [];

  closed: { code?: number; reason?: string } | null = null;

  constructor() {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.onclose?.({
      code: code ?? 1000,
      reason: reason ?? "",
      wasClean: true,
    });
  }

  open(): void {
    this.onopen?.({});
  }

  receive(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

function envelope(type: string, payload: unknown, id = "server-1") {
  return { v: 1, type, id, ts: 1777000000000, payload };
}

test("requires secure URLs and authentication by default", () => {
  assert.throws(
    () =>
      createRealtimeClient({
        url: "ws://example.com/socket",
        allowAnonymous: true,
      }),
    (error: unknown) =>
      error instanceof RealtimeError && error.code === "INVALID_URL",
  );
  assert.throws(
    () => createRealtimeClient({ url: "wss://example.com/socket" }),
    (error: unknown) =>
      error instanceof RealtimeError && error.code === "INVALID_CONFIGURATION",
  );
  assert.doesNotThrow(() =>
    createRealtimeClient({
      url: "ws://127.0.0.1:3000/socket",
      allowAnonymous: true,
    }),
  );
});

test("activity stack provides stable top-first overlap metadata", () => {
  const stack = new PresenceActivityStack({
    maxVisible: 3,
    maxItems: 4,
    overlapPx: 12,
    scaleStep: 0.05,
    opacityStep: 0.1,
    ttlMs: 10_000,
    now: () => 1_777_000_000_000,
  });
  stack.push(
    activity("a", "conversation-a", "alice", "typing", 1_777_000_000_000),
  );
  stack.push(
    activity("b", "conversation-b", "bob", "recording", 1_777_000_000_001),
  );
  stack.push(
    activity("c", "conversation-c", "carol", "typing", 1_777_000_000_002),
  );

  const snapshot = stack.getSnapshot();
  assert.deepEqual(
    snapshot.visible.map((entry) => [
      entry.item.userId,
      entry.index,
      entry.offsetY,
      entry.scale,
      entry.opacity,
      entry.zIndex,
    ]),
    [
      ["carol", 0, 0, 1, 1, 3],
      ["bob", 1, 12, 0.95, 0.9, 2],
      ["alice", 2, 24, 0.9, 0.8, 1],
    ],
  );
  assert.equal(snapshot.overflowCount, 0);
  stack.destroy();
});

test("activity stack replaces a repeated conversation participant and reports overflow", () => {
  const stack = new PresenceActivityStack({
    maxVisible: 2,
    maxItems: 3,
    ttlMs: 10_000,
    now: () => 1_777_000_000_000,
  });
  stack.push(
    activity("old", "conversation-a", "alice", "typing", 1_777_000_000_000),
  );
  stack.push(
    activity("new", "conversation-a", "alice", "typing", 1_777_000_000_001),
  );
  stack.push(
    activity("b", "conversation-b", "bob", "typing", 1_777_000_000_002),
  );
  stack.push(
    activity("c", "conversation-c", "carol", "typing", 1_777_000_000_003),
  );

  const snapshot = stack.getSnapshot();
  assert.deepEqual(
    snapshot.visible.map((entry) => entry.item.id),
    ["c", "b"],
  );
  assert.equal(snapshot.totalCount, 3);
  assert.equal(snapshot.overflowCount, 1);
  stack.dismiss(snapshot.visible[0]?.key ?? "");
  assert.deepEqual(
    stack.getSnapshot().visible.map((entry) => entry.item.id),
    ["b", "new"],
  );
  stack.destroy();
});

test("generic activity stack can mix message-like banners without presence dedupe", () => {
  type MessageBanner = {
    id: string;
    conversationId: string;
    createdAt: number;
    title: string;
    body: string;
  };
  const stack = new ActivityStack<MessageBanner>({
    maxVisible: 2,
    maxItems: 4,
    ttlMs: 10_000,
    now: () => 1_777_000_000_000,
  });
  stack.push({
    id: "message-1",
    conversationId: "conversation-a",
    createdAt: 1_777_000_000_000,
    title: "Alice",
    body: "Hello",
  });
  stack.push({
    id: "message-2",
    conversationId: "conversation-a",
    createdAt: 1_777_000_000_001,
    title: "Alice",
    body: "Are you there?",
  });
  const snapshot = stack.getSnapshot();
  assert.deepEqual(
    snapshot.visible.map((entry) => entry.item.id),
    ["message-2", "message-1"],
  );
  assert.equal(snapshot.totalCount, 2);
  stack.destroy();
});

test("authenticates before flushing queued application messages", async () => {
  FakeSocket.instances = [];
  const messages: unknown[] = [];
  const client = createRealtimeClient({
    url: "wss://example.com/socket",
    token: "short-lived-token",
    createSocket: () => new FakeSocket(),
    heartbeatIntervalMs: 60_000,
    onMessage: (message) => messages.push(message),
  });

  const id = client.send("chat.message", { text: "hello" });
  await client.connect();
  const socket = FakeSocket.instances[0];
  assert.ok(socket);
  socket.open();
  assert.equal(socket.sent.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(socket.sent.length, 1);
  const auth = JSON.parse(socket.sent[0] ?? "null") as {
    type: string;
    payload: { token: string };
  };
  assert.equal(auth.type, "$lynxship.auth");
  assert.equal(auth.payload.token, "short-lived-token");
  socket.receive(envelope("$lynxship.auth.ok", null));
  assert.equal(socket.sent.length, 2);
  assert.equal(JSON.parse(socket.sent[1] ?? "null").id, id);
  socket.receive(envelope("chat.message", { text: "world" }));
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as { type: string }).type, "chat.message");
  client.close();
});

test("rejects invalid and oversized messages without invoking the app handler", async () => {
  FakeSocket.instances = [];
  const errors: RealtimeError[] = [];
  const messages: unknown[] = [];
  const client = createRealtimeClient({
    url: "wss://example.com/socket",
    token: "token",
    createSocket: () => new FakeSocket(),
    maxMessageBytes: 128,
    heartbeatIntervalMs: 60_000,
    onError: (error) => errors.push(error),
    onMessage: (message) => messages.push(message),
  });
  assert.throws(
    () => client.send("chat.message", { text: "x".repeat(200) }),
    (error: unknown) =>
      error instanceof RealtimeError && error.code === "MESSAGE_TOO_LARGE",
  );
  await client.connect();
  const socket = FakeSocket.instances[0];
  assert.ok(socket);
  socket.open();
  socket.receive({
    v: 1,
    type: "chat.message",
    id: "server-1",
    ts: 1,
    payload: { text: "x" },
  });
  assert.equal(messages.length, 0);
  assert.ok(errors.some((error) => error.code === "PROTOCOL_ERROR"));
  assert.equal(socket.closed?.code, 1002);
});

test("bounds the outbound queue", () => {
  const client = createRealtimeClient({
    url: "wss://example.com/socket",
    token: "token",
    maxQueueMessages: 1,
    maxQueueBytes: 1024,
  });
  client.send("chat.message", { text: "one" });
  assert.throws(
    () => client.send("chat.message", { text: "two" }),
    (error: unknown) =>
      error instanceof RealtimeError && error.code === "QUEUE_FULL",
  );
});

test("presence emits deduplicated typing and recording states", async () => {
  FakeSocket.instances = [];
  const events: unknown[] = [];
  const presence = createPresenceClient({
    url: "wss://example.com/socket",
    token: "token",
    createSocket: () => new FakeSocket(),
    typingIdleMs: 20,
    heartbeatMs: 60_000,
    onEvent: (event) => events.push(event),
  });

  await presence.connect();
  const socket = FakeSocket.instances[0];
  assert.ok(socket);
  socket.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  socket.receive(envelope("$lynxship.auth.ok", null));

  presence.noteTyping("conversation-1");
  presence.noteTyping("conversation-1");
  presence.startRecording("conversation-1");

  const sentTypes = socket.sent.map(
    (value) => (JSON.parse(value) as { type: string }).type,
  );
  assert.equal(
    sentTypes.filter((type) => type === "presence.typing").length,
    1,
  );
  assert.equal(
    sentTypes.filter((type) => type === "presence.recording").length,
    1,
  );

  await new Promise((resolve) => setTimeout(resolve, 30));
  presence.stopRecording("conversation-1");
  const afterIdleTypes = socket.sent.map(
    (value) => (JSON.parse(value) as { type: string }).type,
  );
  assert.equal(
    afterIdleTypes.filter((type) => type === "presence.typing").length,
    2,
  );
  assert.equal(
    afterIdleTypes.filter((type) => type === "presence.recording").length,
    2,
  );

  socket.receive(
    envelope("presence.changed", {
      conversationId: "conversation-1",
      userId: "user-2",
      kind: "typing",
      active: true,
      expiresAt: Date.now() + 10_000,
    }),
  );
  assert.equal(events.length, 1);
  assert.equal((events[0] as { userId: string }).userId, "user-2");

  presence.close();
});

test("presence does not accept malformed remote events or stale background state", async () => {
  FakeSocket.instances = [];
  const events: unknown[] = [];
  const presence = createPresenceClient({
    url: "wss://example.com/socket",
    token: "token",
    createSocket: () => new FakeSocket(),
    heartbeatMs: 60_000,
    onEvent: (event) => events.push(event),
  });

  await presence.connect();
  const socket = FakeSocket.instances[0];
  assert.ok(socket);
  socket.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  socket.receive(envelope("$lynxship.auth.ok", null));

  socket.receive(
    envelope("presence.changed", {
      conversationId: "conversation-1",
      userId: "",
      kind: "typing",
      active: true,
    }),
  );
  assert.equal(events.length, 0);

  presence.startRecording("conversation-1");
  await presence.setAppState("background");
  assert.equal(presence.getSnapshot().recordingConversations, 0);
  assert.equal(presence.getSnapshot().appState, "background");
  assert.equal(socket.closed?.code, 1000);

  const stateFrames = socket.sent
    .map(
      (value) =>
        JSON.parse(value) as { type: string; payload: { active?: boolean } },
    )
    .filter((value) => value.type === "presence.recording");
  assert.equal(stateFrames.at(-1)?.payload.active, false);

  presence.close();
});

test("presence state store aggregates group members, profiles, and TTLs", () => {
  let now = 1_000;
  const store = new PresenceStateStore({
    now: () => now,
    defaultTtlMs: 100,
    maxTtlMs: 1_000,
    maxParticipantsPerConversation: 2,
  });
  store.setProfile("alice", {
    displayName: "Alice",
    avatarUrl: "https://cdn.example.com/alice.png",
  });
  store.setProfile("bob", { displayName: "Bob" });

  assert.equal(
    store.apply({
      conversationId: "group-1",
      userId: "alice",
      kind: "typing",
      active: true,
      expiresAt: 1_050,
    }),
    true,
  );
  assert.equal(
    store.apply({
      conversationId: "group-1",
      userId: "bob",
      kind: "typing",
      active: true,
      expiresAt: 1_050,
    }),
    true,
  );
  assert.equal(
    store.apply({
      conversationId: "group-1",
      userId: "bob",
      kind: "recording",
      active: true,
      expiresAt: 1_050,
    }),
    true,
  );

  const group = store.getConversation("group-1");
  assert.deepEqual(
    group.typing.map((participant) => participant.profile?.displayName),
    ["Alice", "Bob"],
  );
  assert.equal(
    group.typing[0]?.profile?.avatarUrl,
    "https://cdn.example.com/alice.png",
  );
  assert.equal(group.recording.length, 1);

  now = 1_051;
  assert.deepEqual(store.getConversation("group-1").typing, []);
  assert.throws(
    () =>
      store.setProfile("alice", {
        displayName: "Alice",
        avatarUrl: "http://insecure.example.com/alice.png",
      }),
    (error: unknown) =>
      error instanceof RealtimeError && error.code === "INVALID_MESSAGE",
  );
});

test("foreground presence notifications are deduplicated per conversation", () => {
  const notifications: Array<{ conversationId: string; userId: string }> = [];
  const notifier = new PresenceActivityNotifier({
    selfUserId: "me",
    shouldNotify: (event) => event.conversationId !== "visible",
    onNotification: (notification) => notifications.push(notification),
    dedupeMs: 60_000,
    windowMs: 60_000,
    maxPerWindow: 10,
  });
  const event = (conversationId: string, userId: string) => ({
    conversationId,
    userId,
    kind: "typing" as const,
    active: true,
  });
  assert.equal(notifier.notify(event("visible", "alice")), false);
  assert.equal(notifier.notify(event("chat-1", "alice")), true);
  assert.equal(notifier.notify(event("chat-1", "alice")), false);
  assert.equal(notifier.notify(event("chat-2", "bob")), true);
  assert.equal(notifier.notify(event("chat-3", "me")), false);
  assert.deepEqual(
    notifications.map(({ conversationId, userId }) => ({
      conversationId,
      userId,
    })),
    [
      { conversationId: "chat-1", userId: "alice" },
      { conversationId: "chat-2", userId: "bob" },
    ],
  );
});

test("ReactLynx activity banners publish the configurable live ring", async () => {
  const source = await readFile(
    resolve("packages/realtime/src/react-lynx-banners.tsx"),
    "utf8",
  );
  const stylesheet = await readFile(
    resolve("packages/realtime/src/react-lynx-banners.css"),
    "utf8",
  );

  await access(resolve("packages/realtime/dist/react-lynx-banners.css"));
  assert.match(source, /isLive\?: boolean/);
  assert.match(source, /liveRingColor\?: string/);
  assert.match(source, /liveRingWidth\?: number/);
  assert.match(source, /theme\?: ActivityBannerTheme/);
  assert.match(source, /classNames\?: ActivityBannerClassNames/);
  assert.match(source, /unstyled\?: boolean/);
  assert.doesNotMatch(source, /lynxship-activity-banner-dismiss/);
  assert.match(source, /borderColor: normalizedLiveRingColor/);
  assert.match(source, /borderWidth: normalizedLiveRingWidth/);
  assert.match(stylesheet, /@keyframes lynxship-live-ring-pulse/);
  assert.match(stylesheet, /transform: scale\(1\.12\)/);
  assert.match(stylesheet, /opacity: 0\.62/);
});

test("read receipts support one-to-one and group read counts", async () => {
  FakeSocket.instances = [];
  const receipts = createReadReceiptClient({
    url: "wss://example.com/socket",
    token: "token",
    createSocket: () => new FakeSocket(),
    heartbeatIntervalMs: 60_000,
  });
  await receipts.connect();
  const socket = FakeSocket.instances[0];
  assert.ok(socket);
  socket.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  socket.receive(envelope("$lynxship.auth.ok", null));

  const messageId = receipts.markRead("group-1", "message-1");
  assert.ok(messageId);
  const sent = socket.sent.map(
    (value) => JSON.parse(value) as { type: string },
  );
  assert.equal(sent.at(-1)?.type, "message.read");
  socket.receive(
    envelope("message.receipt.changed", {
      conversationId: "group-1",
      messageId: "message-1",
      userId: "alice",
      kind: "read",
      occurredAt: Date.now(),
    }),
  );
  socket.receive(
    envelope("message.receipt.changed", {
      conversationId: "group-1",
      messageId: "message-1",
      userId: "bob",
      kind: "read",
      occurredAt: Date.now(),
    }),
  );
  assert.deepEqual(receipts.getMessage("group-1", "message-1").readBy, [
    "alice",
    "bob",
  ]);
  assert.equal(receipts.markRead("group-1", "message-1"), "");
  receipts.close();
});
