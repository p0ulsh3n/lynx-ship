import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeviceStorage,
  createMemoryStorage,
  StorageKeyError,
  StorageSerializationError,
} from "@lynxship/device-storage";

test("serializes typed values through an async adapter", async () => {
  const storage = createDeviceStorage(createMemoryStorage());
  await storage.set("profile", { name: "Lynx", count: 2 });
  assert.deepEqual(
    await storage.get<{ name: string; count: number }>("profile"),
    { name: "Lynx", count: 2 },
  );
  await storage.remove("profile");
  assert.equal(await storage.get("profile"), null);
});

test("rejects unsafe keys and values that JSON cannot represent", async () => {
  const storage = createDeviceStorage(createMemoryStorage());
  await assert.rejects(storage.get(""), StorageKeyError);
  await assert.rejects(storage.set("bad\nkey", true), StorageKeyError);
  await assert.rejects(
    storage.set("missing", undefined),
    StorageSerializationError,
  );
});

test("supports safe namespaces and lazy expiration without changing the adapter", async () => {
  const adapter = createMemoryStorage();
  const storage = createDeviceStorage(adapter);
  await storage.set("token", { value: "secret" }, { namespace: "auth" });
  assert.deepEqual(await storage.get("token", { namespace: "auth" }), {
    value: "secret",
  });
  assert.equal(await storage.get("token"), null);
  await storage.set("short", true, { validDurationMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 3));
  assert.equal(await storage.get("short"), null);
  await assert.rejects(
    storage.set("key", true, { namespace: "not safe" }),
    StorageKeyError,
  );
});
