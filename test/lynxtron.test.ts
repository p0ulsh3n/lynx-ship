import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLynxtronArtifact,
  verifyLynxtronArtifact,
} from "@lynxship/lynxtron";

test("verifies artifact bytes and refuses a mismatched host target", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxtron-"));
  const path = join(root, "main.lynx.bundle");
  await writeFile(path, "bundle");
  const sha256 = createHash("sha256").update("bundle").digest("hex");
  const plan = await verifyLynxtronArtifact({
    path,
    sha256,
    target: "macos-arm64",
  });
  let loaded = false;
  await loadLynxtronArtifact(plan, {
    target: "macos-arm64",
    loadBundle: async () => {
      loaded = true;
    },
  });
  assert.equal(loaded, true);
  await assert.rejects(
    () =>
      loadLynxtronArtifact(plan, {
        target: "windows-x64",
        loadBundle: async () => undefined,
      }),
    /target/,
  );
});
