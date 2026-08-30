import assert from "node:assert/strict";
import test from "node:test";
import {
  BridgeError,
  type BridgeValue,
  createBridgeClient,
  createLynxBridgeTransport,
  createSchemaGuard,
  createTypedBridge,
  defineTypedBridgeMethod,
  defineTypedBridgePackage,
  generateBridgeSource,
  validateBridgeIdl,
} from "@lynxship/bridge";

test("bridge enforces an allowlist and payload bounds", async () => {
  const calls: string[] = [];
  const bridge = createBridgeClient({
    transport: {
      async invoke(method, args) {
        calls.push(`${method}:${JSON.stringify(args)}`);
        return { ok: true };
      },
    },
    methods: [{ name: "device.open", maxPayloadBytes: 100 }],
  });
  assert.deepEqual(await bridge.call("device.open", { screen: "settings" }), {
    ok: true,
  });
  await assert.rejects(() => bridge.call("device.secret", {}), {
    code: "BRIDGE_METHOD_DENIED",
  });
  await assert.rejects(
    () => bridge.call("device.open", { value: "x".repeat(200) }),
    {
      code: "BRIDGE_PAYLOAD_TOO_LARGE",
    },
  );
  assert.equal(calls.length, 1);
});

test("bridge turns an aborted transport into a typed timeout", async () => {
  const bridge = createBridgeClient({
    transport: {
      invoke(_method, _args, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
    },
    methods: [{ name: "slow", timeoutMs: 5 }],
  });
  await assert.rejects(
    () => bridge.call("slow", null),
    (error: unknown) => {
      return error instanceof BridgeError && error.code === "BRIDGE_TIMEOUT";
    },
  );
});

test("bridge rejects conflicting manifests and non-serializable arguments", async () => {
  assert.throws(
    () =>
      createBridgeClient({
        transport: { invoke: async () => null },
        methods: [
          { name: "one", timeoutMs: 10 },
          { name: "one", timeoutMs: 20 },
        ],
      }),
    { code: "BRIDGE_INVALID_CONTRACT" },
  );
  assert.throws(
    () =>
      createBridgeClient({
        transport: { invoke: async () => null },
        methods: [
          { name: "two", version: "1.0.0" },
          { name: "two", version: "2.0.0" },
        ],
      }),
    { code: "BRIDGE_INVALID_CONTRACT" },
  );
  const bridge = createBridgeClient({
    transport: { invoke: async () => null },
    methods: [{ name: "one" }],
  });
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  await assert.rejects(() => bridge.call("one", cyclic as never), {
    code: "BRIDGE_INVALID_CONTRACT",
  });
  await assert.rejects(() => bridge.call("one", Number.NaN as never), {
    code: "BRIDGE_INVALID_CONTRACT",
  });
});

test("bridge cancels an in-flight transport when disposed", async () => {
  let aborted = false;
  const bridge = createBridgeClient({
    transport: {
      invoke(_method, _args, signal) {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
        return new Promise(() => {});
      },
    },
    methods: [{ name: "native.longTask", timeoutMs: 10_000 }],
  });
  const call = bridge.call("native.longTask", null);
  bridge.dispose();
  await assert.rejects(call, { code: "BRIDGE_DISPOSED" });
  assert.equal(aborted, true);
});

test("bridge enforces declared capability and permission contracts", async () => {
  let context: unknown;
  const bridge = createBridgeClient({
    transport: {
      async invoke(_method, _args, _signal, invocationContext) {
        context = invocationContext;
        return true;
      },
    },
    methods: [
      {
        name: "media.open",
        version: "2.0.0",
        capability: "media.camera",
        permissions: ["camera:read"],
        thread: "main",
      },
    ],
    capabilities: ["media.camera"],
    permissions: ["camera:read"],
    createRequestId: () => "request-1",
  });
  assert.equal(
    await bridge.call("media.open", {}, { idempotencyKey: "media-1" }),
    true,
  );
  assert.deepEqual(context, {
    requestId: "request-1",
    idempotencyKey: "media-1",
    version: "2.0.0",
    thread: "main",
  });

  const denied = createBridgeClient({
    transport: { invoke: async () => null },
    methods: [{ name: "media.open", capability: "media.camera" }],
  });
  await assert.rejects(() => denied.call("media.open", {}), {
    code: "BRIDGE_CAPABILITY_DENIED",
  });
});

test("bridge retries only safe idempotent calls and forwards scheduling metadata", async () => {
  let attempts = 0;
  const contexts: unknown[] = [];
  const bridge = createBridgeClient({
    transport: {
      async invoke(_method, _args, _signal, context) {
        attempts += 1;
        contexts.push(context);
        if (attempts < 3) throw new Error("temporary transport failure");
        return { ok: true };
      },
    },
    methods: [{ name: "upload.resume" }],
  });
  assert.deepEqual(
    await bridge.call(
      "upload.resume",
      { uploadId: "u_1" },
      {
        idempotencyKey: "upload-u_1",
        priority: "high",
        retry: { maxAttempts: 3, delayMs: 0 },
      },
    ),
    { ok: true },
  );
  assert.equal(attempts, 3);
  assert.deepEqual(
    contexts.map((context) => (context as { attempt: number }).attempt),
    [1, 2, 3],
  );
  await assert.rejects(
    () =>
      bridge.call("upload.resume", null, {
        retry: { maxAttempts: 2, delayMs: 0 },
      }),
    { code: "BRIDGE_INVALID_CONTRACT" },
  );
});

test("bridge supports bounded per-call timeouts and canonical native responses", async () => {
  const bridge = createBridgeClient({
    transport: {
      async invoke(method) {
        assert.equal(method, "storage.getItem");
        return "fr";
      },
    },
    methods: [{ name: "storage.getItem" }],
  });
  assert.equal(
    await bridge.callWithTimeout("storage.getItem", { key: "locale" }, 1_000),
    "fr",
  );
  await assert.rejects(
    () => bridge.call("storage.getItem", null, { timeoutMs: 0 }),
    { code: "BRIDGE_INVALID_CONTRACT" },
  );
  await assert.rejects(
    () => bridge.call("storage.getItem", null, { timeoutMs: 120_001 }),
    { code: "BRIDGE_INVALID_CONTRACT" },
  );
});

test("Lynx bridge transport preserves the secure request envelope and native events", async () => {
  const requests: Array<Record<string, unknown>> = [];
  let eventListener: ((value: unknown) => void) | undefined;
  let unsubscribed = false;
  const transport = createLynxBridgeTransport({
    invoke(requestJson, callback) {
      requests.push(JSON.parse(requestJson) as Record<string, unknown>);
      callback(JSON.stringify({ code: 1, msg: "ok", data: { ok: true } }));
    },
    subscribe(_event, callback) {
      eventListener = callback;
    },
    unsubscribe() {
      unsubscribed = true;
    },
  });
  const bridge = createBridgeClient({
    transport,
    methods: [{ name: "storage.getItem", version: "1.0.0" }],
    events: ["storage.changed"],
    createRequestId: () => "request-1",
  });
  assert.deepEqual(
    await bridge.call(
      "storage.getItem",
      { key: "locale" },
      {
        idempotencyKey: "read-locale",
        priority: "normal",
      },
    ),
    { ok: true },
  );
  assert.deepEqual(requests[0], {
    method: "storage.getItem",
    args: { key: "locale" },
    requestId: "request-1",
    idempotencyKey: "read-locale",
    version: "1.0.0",
    priority: "normal",
  });
  const received: unknown[] = [];
  const remove = bridge.subscribe("storage.changed", (payload) =>
    received.push(payload),
  );
  eventListener?.(
    JSON.stringify({ code: 1, msg: "ok", data: { key: "locale" } }),
  );
  remove();
  assert.deepEqual(received, [{ key: "locale" }]);
  assert.equal(unsubscribed, true);

  const failingTransport = createLynxBridgeTransport({
    invoke(_requestJson, callback) {
      callback(JSON.stringify({ code: -2, msg: "permission denied" }));
    },
  });
  await assert.rejects(
    () =>
      createBridgeClient({
        transport: failingTransport,
        methods: [{ name: "storage.getItem" }],
      }).call("storage.getItem", null),
    { code: "BRIDGE_NATIVE_ERROR" },
  );
});

test("typed bridge preserves the secure raw boundary and validates responses", async () => {
  type Methods = {
    "storage.getItem": { params: { key: string }; result: string | null };
  };
  const raw = createBridgeClient({
    transport: {
      async invoke(method, args) {
        assert.equal(method, "storage.getItem");
        assert.deepEqual(args, { key: "locale" });
        return "fr";
      },
    },
    methods: [{ name: "storage.getItem", version: "1.0.0" }],
  });
  const typed = createTypedBridge<Methods>(raw, {
    "storage.getItem": defineTypedBridgeMethod({
      descriptor: { name: "storage.getItem", version: "1.0.0" },
      validateParams: (value): value is { key: string } =>
        typeof value === "object" &&
        value !== null &&
        "key" in value &&
        typeof value.key === "string",
      validateResult: (value): value is string | null =>
        value === null || typeof value === "string",
    }),
  });
  assert.equal(await typed.call("storage.getItem", { key: "locale" }), "fr");
  await assert.rejects(
    () => typed.call("storage.getItem", { key: 3 } as never),
    { code: "BRIDGE_INVALID_CONTRACT" },
  );

  const invalid = createTypedBridge<Methods>(
    createBridgeClient({
      transport: { invoke: async () => 3 },
      methods: [{ name: "storage.getItem" }],
    }),
    {
      "storage.getItem": defineTypedBridgeMethod({
        descriptor: { name: "storage.getItem" },
        validateResult: (value): value is string | null =>
          value === null || typeof value === "string",
      }),
    },
  );
  await assert.rejects(() => invalid.call("storage.getItem", { key: "x" }), {
    code: "BRIDGE_INVALID_RESPONSE",
  });
  assert.throws(
    () =>
      createTypedBridge<Methods>(raw, {
        "storage.getItem": defineTypedBridgeMethod({
          descriptor: { name: "storage.getItem", version: "2.0.0" },
        }),
      }),
    { code: "BRIDGE_INVALID_CONTRACT" },
  );
});

test("typed bridge method packages stay behind the raw security boundary", async () => {
  const packageDefinition = defineTypedBridgePackage("storage", {
    "storage.getItem": defineTypedBridgeMethod({
      descriptor: { name: "storage.getItem", version: "1.0.0" },
      validateResult: (value): value is string | null =>
        value === null || typeof value === "string",
    }),
  });
  const bridge = createBridgeClient({
    transport: { invoke: async () => "fr" },
    methods: [{ name: "storage.getItem", version: "1.0.0" }],
  });
  assert.equal(
    await packageDefinition.create(bridge).call("storage.getItem", null),
    "fr",
  );
  assert.throws(() => defineTypedBridgePackage("Bad Package", {}), {
    code: "BRIDGE_INVALID_CONTRACT",
  });
});

test("typed bridge packages validate native event payloads", () => {
  const listeners = new Map<string, (payload: BridgeValue) => void>();
  const bridge = createBridgeClient({
    transport: {
      invoke: async () => null,
      subscribe(event, listener) {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      },
    },
    methods: [],
    events: ["notifications.opened"],
  });
  const notifications = defineTypedBridgePackage(
    "notifications",
    {},
    {
      events: {
        "notifications.opened": {
          validatePayload: (value): value is { id: string } =>
            typeof value === "object" &&
            value !== null &&
            "id" in value &&
            typeof value.id === "string",
        },
      },
    },
  );
  const received: unknown[] = [];
  notifications.create(bridge).subscribe("notifications.opened", (event) => {
    received.push(event);
  });
  listeners.get("notifications.opened")?.({ id: "ok" });
  listeners.get("notifications.opened")?.({ id: 3 });
  assert.deepEqual(received, [{ id: "ok" }]);
});

test("bridge IDL validates schemas and generates deterministic typed artifacts", () => {
  const document = {
    version: 1 as const,
    methods: [
      {
        descriptor: {
          name: "storage.getItem",
          version: "1.0.0",
          capability: "storage.read",
          permissions: ["storage:read"],
          thread: "background" as const,
        },
        params: {
          type: "object" as const,
          properties: {
            key: { type: "string" as const, minLength: 1, maxLength: 128 },
          },
          required: ["key"] as const,
          additionalProperties: false,
        },
        result: {
          type: "union" as const,
          anyOf: [{ type: "string" as const }, { type: "null" as const }],
        },
      },
    ],
    events: [
      {
        name: "storage.changed",
        payload: {
          type: "object" as const,
          properties: { key: { type: "string" as const } },
          required: ["key"] as const,
        },
      },
    ],
  };
  validateBridgeIdl(document);
  const guard = createSchemaGuard(document.methods[0]!.params);
  assert.equal(guard({ key: "locale" }), true);
  assert.equal(guard({ key: "" }), false);
  assert.equal(guard({ key: "locale", extra: true }), false);
  const generated = generateBridgeSource(document);
  assert.deepEqual(generated.manifest, [document.methods[0]!.descriptor]);
  assert.match(generated.source, /createTypedBridge/);
  assert.match(generated.source, /storage\.getItem/);
  assert.match(generated.source, /storage\.changed/);
  assert.equal(generateBridgeSource(document).source, generated.source);
  assert.throws(
    () =>
      validateBridgeIdl({
        version: 1,
        methods: [
          { ...document.methods[0]!, descriptor: { name: "storage.getItem" } },
          document.methods[0]!,
        ],
      }),
    { code: "BRIDGE_INVALID_CONTRACT" },
  );
});
