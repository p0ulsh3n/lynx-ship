import test from "node:test";
import assert from "node:assert/strict";
import { LocalBuildProvider, ProviderCatalog } from "@lynxship/build-providers";

const job = {
  id: "build-1",
  projectId: "project-1",
  organizationId: "org-1",
  platform: "android" as const,
  profile: "debug",
  sourceHash: "source-hash",
  state: "created" as const,
  attempts: 0,
  logs: [],
  transitions: [],
};

test("local build provider keeps worker and job platforms aligned", async () => {
  const provider = new LocalBuildProvider();
  const worker = await provider.acquire(job);
  const result = await provider.execute(worker, job);

  assert.equal(worker.platform, "android");
  assert.equal(worker.providerId, "local");
  assert.ok(result.artifact);
  assert.equal(result.artifact.hash, "local-build-1");
  await provider.release();
});

test("local build provider rejects a worker for another platform", async () => {
  const provider = new LocalBuildProvider();
  const worker = await provider.provision({ platform: "ios" });

  await assert.rejects(
    () => provider.execute(worker, job),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "PROVIDER_PLATFORM",
  );
});

test("provider catalog validates, replaces and lists providers safely", () => {
  const catalog = new ProviderCatalog();
  const provider = new LocalBuildProvider();

  assert.equal(catalog.register(provider), provider);
  assert.equal(catalog.get("local"), provider);
  assert.deepEqual(catalog.list(), [provider]);
  assert.throws(
    () => catalog.register({ id: "", acquire: provider.acquire } as never),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "PROVIDER_INPUT",
  );
  assert.throws(
    () => catalog.get("missing"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "PROVIDER_NOT_FOUND",
  );
});
