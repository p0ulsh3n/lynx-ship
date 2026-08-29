import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAssetSyncPlan,
  createAssetManifest,
  createAssetSyncPlan,
  discoverAssets,
  manifestHash,
  validateAssetManifest,
} from "@lynxship/asset-pipeline";

test("discovers deterministic assets and excludes credentials/build state", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-assets-"));
  await writeFile(join(root, "main.lynx.bundle"), "bundle");
  await writeFile(join(root, "icon.png"), "image");
  await writeFile(join(root, "sound.wav"), "audio");
  await writeFile(join(root, "clip.mov"), "video");
  await writeFile(join(root, "stream.webm"), "video");
  await writeFile(join(root, ".env"), "SECRET=do-not-copy");
  const assets = await discoverAssets({ root });
  assert.deepEqual(
    assets.map((asset) => asset.path),
    ["clip.mov", "icon.png", "main.lynx.bundle", "sound.wav", "stream.webm"],
  );
  assert.equal(assets[1]?.kind, "image");
  assert.equal(assets[0]?.contentType, "video/quicktime");
  assert.equal(assets[3]?.contentType, "audio/wav");
  assert.equal(assets[4]?.contentType, "video/webm");
  const manifest = await createAssetManifest({ root });
  assert.equal(manifest.files.length, 5);
  assert.equal(manifest.sha256.length, 64);
});

test("copies assets and verifies every destination hash", async () => {
  const source = await mkdtemp(join(tmpdir(), "lynx-assets-source-"));
  const target = await mkdtemp(join(tmpdir(), "lynx-assets-target-"));
  await writeFile(join(source, "main.lynx.bundle"), "bundle");
  const manifest = await createAssetManifest({ root: source });
  await applyAssetSyncPlan(createAssetSyncPlan(manifest, target));
  assert.equal(
    await readFile(join(target, "main.lynx.bundle"), "utf8"),
    "bundle",
  );
});

test("restores pre-existing assets when a later copy fails", async () => {
  const source = await mkdtemp(join(tmpdir(), "lynx-assets-source-"));
  const target = await mkdtemp(join(tmpdir(), "lynx-assets-target-"));
  await writeFile(join(source, "first.txt"), "new-first");
  await writeFile(join(source, "second.txt"), "new-second");
  await writeFile(join(target, "first.txt"), "old-first");
  const manifest = await createAssetManifest({ root: source });
  const plan = createAssetSyncPlan(
    {
      ...manifest,
      files: manifest.files.map((asset) =>
        asset.path === "second.txt"
          ? { ...asset, sha256: "0".repeat(64) }
          : asset,
      ),
    },
    target,
  );
  await assert.rejects(applyAssetSyncPlan(plan), {
    code: "ASSET_HASH_MISMATCH",
  });
  assert.equal(await readFile(join(target, "first.txt"), "utf8"), "old-first");
  await assert.rejects(access(join(target, "second.txt")));
});

test("rejects a manifest target outside the destination root", async () => {
  const source = await mkdtemp(join(tmpdir(), "lynx-assets-source-"));
  await writeFile(join(source, "file.txt"), "content");
  const manifest = await createAssetManifest({ root: source });
  assert.throws(
    () =>
      createAssetSyncPlan(
        {
          ...manifest,
          files: [{ ...manifest.files[0]!, path: "../escape.txt" }],
        },
        join(source, "target"),
      ),
    { code: "ASSET_PATH_ESCAPE" },
  );
  await assert.rejects(access(join(source, "target", "escape.txt")));
});

test("validates manifest integrity and rejects duplicate or unsafe records", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-assets-validation-"));
  const manifest = await createAssetManifest({ root });
  validateAssetManifest(manifest);
  assert.equal(manifestHash(manifest.files), manifest.sha256);
  assert.throws(
    () =>
      validateAssetManifest({
        ...manifest,
        files: [
          {
            path: "../escape.txt",
            size: 0,
            sha256: "0".repeat(64),
            kind: "other",
            contentType: "text/plain",
          },
        ],
      }),
    { code: "ASSET_PATH_ESCAPE" },
  );
  assert.throws(
    () =>
      validateAssetManifest({
        ...manifest,
        files: [
          {
            path: "same.txt",
            size: 0,
            sha256: "0".repeat(64),
            kind: "other",
            contentType: "text/plain",
          },
          {
            path: "same.txt",
            size: 0,
            sha256: "0".repeat(64),
            kind: "other",
            contentType: "text/plain",
          },
        ],
      }),
    { code: "ASSET_MANIFEST_INVALID" },
  );
});
