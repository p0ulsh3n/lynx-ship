import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenManager } from "@lynxship/auth";
import {
  createApi,
  loadPersistentApp,
  FixedWindowRateLimiter,
} from "@lynxship/api";
import { sha256 } from "@lynxship/contracts";

test("Fastify API exposes health and build contract", async (t) => {
  const server = createApi();
  t.after(() => server.close());
  const health = await server.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok" });
  const dashboard = await server.inject({ method: "GET", url: "/" });
  assert.equal(dashboard.statusCode, 200);
  assert.match(dashboard.body, /LynxShip/);
  const created = await server.inject({
    method: "POST",
    url: "/v1/builds",
    payload: {
      projectId: "p",
      organizationId: "o",
      platform: "android",
      profile: "production",
    },
  });
  assert.equal(created.statusCode, 201);
  const job = created.json() as { id: string };
  const run = await server.inject({
    method: "POST",
    url: `/v1/builds/${job.id}/run`,
  });
  assert.equal((run.json() as { state: string }).state, "success");
});

test("Fastify auth enforces scopes while health remains public", async (t) => {
  const manager = new TokenManager();
  const token = manager.create({
    name: "ci",
    organizationId: "o",
    scopes: ["build:write", "project:read"],
  });
  const server = createApi({ tokenManager: manager });
  t.after(() => server.close());
  assert.equal(
    (await server.inject({ method: "GET", url: "/health" })).statusCode,
    200,
  );
  assert.equal(
    (await server.inject({ method: "GET", url: "/v1/ota/public-key" }))
      .statusCode,
    200,
  );
  assert.equal(
    (await server.inject({ method: "POST", url: "/v1/builds", payload: {} }))
      .statusCode,
    401,
  );
  const response = await server.inject({
    method: "POST",
    url: "/v1/builds",
    headers: { authorization: `Bearer ${token.value}` },
    payload: {
      projectId: "p",
      organizationId: "o",
      platform: "android",
      profile: "production",
    },
  });
  assert.equal(response.statusCode, 201);
});

test("Fastify rate limiting returns 429 with a retry hint", async (t) => {
  const server = createApi({
    rateLimiter: new FixedWindowRateLimiter({ limit: 1, windowMs: 10_000 }),
  });
  t.after(() => server.close());
  assert.equal(
    (await server.inject({ method: "GET", url: "/health" })).statusCode,
    200,
  );
  const limited = await server.inject({ method: "GET", url: "/health" });
  assert.equal(limited.statusCode, 429);
  assert.ok(limited.headers["retry-after"]);
});

test("persistent API state survives app reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-api-"));
  const first = await loadPersistentApp(root);
  const job = await first.app.builds.create({
    projectId: "p",
    organizationId: "o",
    platform: "android",
    profile: "production",
  });
  await first.app.builds.run(job.id);
  await first.save();
  const second = await loadPersistentApp(root);
  assert.equal(second.app.builds.get(job.id).state, "success");
});

test("organization and project resources are persisted through the API service", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-tenant-"));
  const first = await loadPersistentApp(root);
  const organization = first.app.tenants.createOrganization("Acme", "user-1");
  const project = first.app.tenants.createProject(organization.id, "Mobile");
  await first.save();
  const second = await loadPersistentApp(root);
  assert.equal(
    second.app.tenants.listProjects(organization.id)[0]?.id,
    project.id,
  );
  assert.equal(
    second.app.tenants.organizations.get(organization.id)?.name,
    "Acme",
  );
});

test("artifact upload stores the exact binary and returns its hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-artifact-"));
  const server = createApi({
    artifactRoot: join(root, ".lynxship", "objects"),
  });
  const content = Buffer.from("real android artifact");
  const hash = sha256(content);
  const response = await server.inject({
    method: "POST",
    url: "/v1/artifacts",
    payload: {
      projectId: "project",
      organizationId: "organization",
      filename: "app-release.apk",
      contentType: "application/vnd.android.package-archive",
      hash,
      dataBase64: content.toString("base64"),
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().artifact.hash, hash);
  assert.deepEqual(
    await readFile(join(root, ".lynxship", "objects", hash)),
    content,
  );
  const metadata = await server.inject({
    method: "POST",
    url: "/v1/artifacts",
    payload: {
      projectId: "project",
      organizationId: "organization",
      filename: "app-release.apk",
      artifact: {
        key: "artifacts/project/build/app-release.apk",
        hash,
        size: content.length,
        contentType: "application/vnd.android.package-archive",
        url: "https://account.r2.cloudflarestorage.com/download",
      },
    },
  });
  assert.equal(metadata.statusCode, 201);
  assert.equal(
    metadata.json().artifact.key,
    "artifacts/project/build/app-release.apk",
  );
  await server.close();
});

test("OTA API exposes its public key and serves the eligible signed bundle", async (t) => {
  const server = createApi();
  t.after(() => server.close());
  const published = await server.inject({
    method: "POST",
    url: "/v1/ota/releases",
    payload: {
      projectId: "ota-project",
      organizationId: "organization",
      channel: "production",
      platform: "android",
      runtimeVersion: "fp-1",
      assets: [
        {
          path: "main.lynx.bundle",
          hash: "a".repeat(64),
          size: 1,
          url: "https://account.r2.cloudflarestorage.com/bundle",
        },
      ],
    },
  });
  assert.equal(published.statusCode, 201);
  const release = published.json() as { manifest: { keyId: string } };
  const key = await server.inject({ method: "GET", url: "/v1/ota/public-key" });
  assert.equal(key.statusCode, 200);
  assert.equal(key.json().keyId, release.manifest.keyId);
  const check = await server.inject({
    method: "GET",
    url: "/v1/ota/check?projectId=ota-project&channel=production&platform=android&runtimeVersion=fp-1&installationId=device-1",
  });
  assert.equal(check.statusCode, 200);
  assert.equal(
    check.json().manifest.assets[0].url,
    "https://account.r2.cloudflarestorage.com/bundle",
  );
});
