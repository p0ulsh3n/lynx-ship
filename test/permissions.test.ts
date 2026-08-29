import test from "node:test";
import assert from "node:assert/strict";
import {
  createPermissionClient,
  type PermissionAdapter,
} from "@lynxship/permissions";

test("permission client is unavailable without a native host and deduplicates requests", async () => {
  assert.equal(
    (await createPermissionClient(undefined).check("camera")).state,
    "unavailable",
  );
  const requested: string[] = [];
  const adapter: PermissionAdapter = {
    check: async (name) => ({ name, state: "denied", canAskAgain: true }),
    request: async (name) => {
      requested.push(name);
      return { name, state: "granted", canAskAgain: false };
    },
  };
  const results = await createPermissionClient(adapter).requestMany([
    "camera",
    "camera",
    "microphone",
  ]);
  assert.deepEqual(requested, ["camera", "microphone"]);
  assert.equal(
    results.every((result) => result.state === "granted"),
    true,
  );
});
