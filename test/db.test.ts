import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonRepository } from "@lynxship/db";

test("JsonRepository serializes concurrent read-modify-write updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-db-"));
  const repository = new JsonRepository(join(root, "state.json"), { count: 0 });

  await Promise.all(
    Array.from({ length: 32 }, () =>
      repository.update((state) => ({ count: state.count + 1 })),
    ),
  );

  assert.deepEqual(await repository.read(), { count: 32 });
  assert.doesNotMatch(
    await readFile(join(root, "state.json"), "utf8"),
    /\.tmp/,
  );
});
