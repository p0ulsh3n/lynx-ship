import test from "node:test";
import assert from "node:assert/strict";
import { createObservability } from "@lynxship/observability";

test("bounds events and redacts secret-like attributes before flushing", async () => {
  const batches: readonly (readonly {
    attributes: Readonly<Record<string, unknown>>;
  }[])[] = [];
  const sink = {
    write: async (
      events: readonly { attributes: Readonly<Record<string, unknown>> }[],
    ) => {
      (batches as unknown as Array<unknown>).push(events);
    },
  };
  const observability = createObservability(sink, {
    maxBuffer: 1,
    clock: () => 10,
  });
  observability.track("login", {
    token: "secret",
    nested: { password: "hidden" },
  });
  observability.track("screen", { ok: true });
  assert.equal(observability.size(), 1);
  await observability.flush();
  const events = batches[0];
  assert.equal(events?.[0]?.attributes.ok, true);
  assert.equal(events?.[0]?.attributes.token, undefined);
});

test("bounds configuration and safely redacts cyclic attributes", () => {
  assert.throws(() =>
    createObservability({ write: async () => {} }, { maxBuffer: 0 }),
  );
  const value: Record<string, unknown> = {};
  value.self = value;
  const observability = createObservability({ write: async () => {} });
  observability.track("cycle", value as never);
  assert.equal(observability.size(), 1);
});
