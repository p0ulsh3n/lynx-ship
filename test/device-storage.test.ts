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
