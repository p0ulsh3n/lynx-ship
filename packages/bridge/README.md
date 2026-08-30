# @lynxship/bridge

An explicit JavaScript-to-native bridge contract for Lynx hosts. The core
client remains host-neutral; the package also ships an opt-in Android/iOS Lynx
transport. Each host injects an allowlisted method/event manifest and owns the
final native implementation.

```ts
import { createBridgeClient } from "@lynxship/bridge";

const bridge = createBridgeClient({
  transport: hostTransport,
  methods: [
    {
      name: "device.openSettings",
      version: "1.0.0",
      capability: "device.settings",
      permissions: ["device:open-settings"],
      thread: "main",
      timeoutMs: 3_000,
    },
  ],
  capabilities: ["device.settings"],
  permissions: ["device:open-settings"],
  events: ["device.resume"],
});

await bridge.call(
  "device.openSettings",
  { screen: "notifications" },
  {
    idempotencyKey: "open-settings-123",
  },
);
```

Per-call timeouts are bounded to prevent an unbounded native wait. The
`callWithTimeout` helper provides the same convenience as the corresponding
Sparkling Method API:

```ts
await bridge.callWithTimeout("storage.getItem", { key: "locale" }, 30_000);
```

Transient transport failures can be retried explicitly, but only with an
idempotency key so a native side effect cannot be duplicated accidentally. A
transport may also use the priority and attempt metadata for scheduling and
telemetry:

```ts
await bridge.call(
  "upload.resume",
  { uploadId: "u_123" },
  {
    idempotencyKey: "upload-resume-u_123",
    priority: "high",
    retry: { maxAttempts: 3, delayMs: 500 },
  },
);
```

Retries are bounded to five attempts and 30 seconds between attempts. Security,
permission, contract and response-validation failures are never retried; timeouts
and transport errors are retried only when the caller opted in.

Community libraries can publish a reusable typed method package without
creating a global singleton or bypassing the host manifest:

```ts
import {
  defineTypedBridgeMethod,
  defineTypedBridgePackage,
} from "@lynxship/bridge";

const storagePackage = defineTypedBridgePackage("storage", {
  "storage.getItem": defineTypedBridgeMethod({
    descriptor: { name: "storage.getItem", version: "1.0.0" },
  }),
});

const storage = storagePackage.create(bridge);
const value = await storage.call("storage.getItem", null);
```

The package factory is only a typed facade: the underlying client still checks
the allowlist, capabilities, permissions, timeouts, payload size and native
response contract. This is the extension point for first-party and community
packages such as navigation, storage or media.

Pure Lynx hosts can use the included native transport instead of writing their
own `NativeModules` adapter:

```ts
import {
  createBridgeClient,
  createLynxBridgeTransport,
} from "@lynxship/bridge";

const bridge = createBridgeClient({
  transport: createLynxBridgeTransport(),
  methods: [{ name: "storage.getItem", version: "1.0.0" }],
});
```

The native transport accepts the canonical response envelope
`{ code: 1, msg, data }`: code `1` resolves with `data`; code `0` or a negative
code rejects with `BRIDGE_NATIVE_ERROR`. The previous
`{ success: true, value }` envelope remains accepted for compatibility.

Autolink installs `LynxShipBridge` on Android and iOS. The application host
implements `LynxShipBridgeHost` and remains responsible for its business
allowlist, authentication, capabilities, permissions and thread dispatch; the
native module rejects malformed or oversized requests before the host sees them.

Method packages can also publish typed event payloads with optional runtime
validators. Invalid native event payloads are ignored before reaching
application listeners, while the underlying event allowlist remains mandatory:

```ts
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

notifications.create(bridge).subscribe("notifications.opened", (event) => {
  console.log(event.id);
});
```

For larger method surfaces, keep one declarative IDL and generate the typed
TypeScript facade, runtime schema guards, event validators and native method
manifest:

```ts
import { generateBridgeSource } from "@lynxship/bridge";

const artifacts = generateBridgeSource({
  version: 1,
  methods: [
    {
      descriptor: { name: "storage.getItem", version: "1.0.0" },
      params: {
        type: "object",
        properties: { key: { type: "string", minLength: 1 } },
        required: ["key"],
        additionalProperties: false,
      },
      result: {
        type: "union",
        anyOf: [{ type: "string" }, { type: "null" }],
      },
    },
  ],
});
// Write artifacts.source to a generated package file and pass
// artifacts.manifest to createBridgeClient on each native host.
```

`validateBridgeIdl` rejects duplicate methods/events, unsafe names, invalid
limits, incomplete object schemas and empty unions before generation.
`createSchemaGuard` is also available for runtime validation without source
generation. Names and object properties are sorted so generated output is
reproducible in CI and reviewable in source control.

Calls are denied unless declared, payloads are bounded, credentials cannot be
silently routed through undeclared methods, and each invocation is cancelled
after its timeout or when the client is disposed. Method descriptors can bind
capabilities, permissions, a version, a native thread and an idempotency key;
the transport receives a correlation request ID. Native adapters remain
responsible for the final OS permission decision, thread affinity,
serialization and platform-specific implementation.
