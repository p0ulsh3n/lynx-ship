import test from "node:test";
import assert from "node:assert/strict";
import { createRouter, RouterError } from "@lynxship/router";

test("matches deep links, query values, history, and subscribers", () => {
  const router = createRouter([{ name: "conversation", pattern: "/chat/:id" }]);
  const seen: string[] = [];
  const unsubscribe = router.subscribe((match) => {
    if (match) seen.push(match.params.id ?? "");
  });
  const match = router.push("/chat/a%2Fb?mode=live");
  assert.equal(match?.params.id, "a/b");
  assert.equal(match?.query.mode, "live");
  assert.equal(router.back(), undefined);
  assert.deepEqual(seen, ["a/b"]);
  unsubscribe();
});

test("rejects malformed route patterns before they can enter history", () => {
  assert.throws(
    () => createRouter([{ name: "bad", pattern: "/chat/:id/:id" }]),
    RouterError,
  );
  assert.throws(
    () => createRouter([{ name: "bad", pattern: "/files/*/tail" }]),
    RouterError,
  );
  assert.throws(
    () => createRouter([{ name: 42, pattern: "/chat" } as never]),
    RouterError,
  );
  assert.throws(
    () => createRouter([{ name: "bad", pattern: 42 } as never]),
    RouterError,
  );
});
