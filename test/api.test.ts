import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenManager } from "@lynxship/auth";
import {
  createSourceSnapshot,
  LocalBuildExecutor,
} from "@lynxship/build-orchestrator";
import {
  createApi,
  loadPersistentApp,
  FixedWindowRateLimiter,
  renderPrometheusMetrics,
} from "@lynxship/api";
import { sha256 } from "@lynxship/contracts";

test("Fastify API exposes health and build contract", async (t) => {
  const dashboardRoot = await mkdtemp(join(tmpdir(), "lynxship-dashboard-"));
  const dashboardDist = join(dashboardRoot, "packages", "dashboard", "dist");
  await mkdir(dashboardDist, { recursive: true });
  await writeFile(
    join(dashboardDist, "index.html"),
    "<!doctype html><html><body>LynxShip test dashboard</body></html>",
  );
  const server = createApi({ dashboardRoot });
  t.after(async () => {
    await server.close();
    await rm(dashboardRoot, { recursive: true, force: true });
  });
  const health = await server.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok" });
  const metrics = await server.inject({ method: "GET", url: "/metrics" });
  assert.equal(metrics.statusCode, 200);
  assert.match(metrics.body, /lynxship_http_requests_total/);
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

test("Prometheus rendering safely escapes labels and rejects malformed keys", () => {
  const rendered = renderPrometheusMetrics({
    'events_total|source=a\\b"c\n=d': 2,
    "events_total|broken": 99,
    "bad-name": 100,
  });
  assert.equal(rendered, 'lynxship_events_total{source="a\\\\b\\"c\\n=d"} 2\n');
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

test("production API refuses the local fake build executor", async (t) => {
  const server = createApi({ allowLocalBuildExecutor: false });
  t.after(() => server.close());
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
  const job = created.json() as { id: string };
  const run = await server.inject({
    method: "POST",
    url: `/v1/builds/${job.id}/run`,
  });
  assert.equal(run.statusCode, 400);
  assert.equal(
    (run.json() as { error: string }).error,
    "BUILD_WORKER_REQUIRED",
  );
});

test("build creation is idempotent for CI retries", async (t) => {
  const manager = new TokenManager();
  const token = manager.create({
    name: "ci",
    organizationId: "org-a",
    scopes: ["build:write"],
  });
  const server = createApi({ tokenManager: manager });
  t.after(() => server.close());
  const payload = {
    projectId: "project-a",
    organizationId: "org-a",
    platform: "android",
    profile: "production",
    idempotencyKey: "github-run-123",
  };
  const headers = { authorization: `Bearer ${token.value}` };
  const first = await server.inject({
    method: "POST",
    url: "/v1/builds",
    headers,
    payload,
  });
  const second = await server.inject({
    method: "POST",
    url: "/v1/builds",
    headers,
    payload,
  });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(
    (second.json() as { id: string }).id,
    (first.json() as { id: string }).id,
  );
});

test("tenant-scoped tokens cannot create or read another organization's builds", async (t) => {
  const manager = new TokenManager();
  const token = manager.create({
    name: "tenant-ci",
    organizationId: "org-a",
    scopes: ["build:write", "project:read"],
  });
  const server = createApi({ tokenManager: manager });
  t.after(() => server.close());
  const forbiddenCreate = await server.inject({
    method: "POST",
    url: "/v1/builds",
    headers: { authorization: `Bearer ${token.value}` },
    payload: {
      projectId: "project-b",
      organizationId: "org-b",
      platform: "android",
      profile: "production",
    },
  });
  assert.equal(forbiddenCreate.statusCode, 403);
  const allowedCreate = await server.inject({
    method: "POST",
    url: "/v1/builds",
    headers: { authorization: `Bearer ${token.value}` },
    payload: {
      projectId: "project-a",
      organizationId: "org-a",
      platform: "android",
      profile: "production",
    },
  });
  assert.equal(allowedCreate.statusCode, 201);
  const job = allowedCreate.json() as { id: string };
  const unscopedList = await server.inject({
    method: "GET",
    url: "/v1/builds",
    headers: { authorization: `Bearer ${token.value}` },
  });
  assert.equal(unscopedList.statusCode, 403);
  const scopedList = await server.inject({
    method: "GET",
    url: "/v1/builds?organizationId=org-a",
    headers: { authorization: `Bearer ${token.value}` },
  });
  assert.equal(scopedList.statusCode, 200);
  assert.equal((scopedList.json() as Array<{ id: string }>)[0]?.id, job.id);
});

test("project-scoped credentials cannot mint org tokens or manage workers", async (t) => {
  const manager = new TokenManager();
  const token = manager.create({
    name: "project-credentials",
    organizationId: "org-a",
    projectId: "project-a",
    scopes: ["credentials:write", "worker:manage"],
  });
  const server = createApi({ tokenManager: manager });
  t.after(() => server.close());
  const headers = { authorization: `Bearer ${token.value}` };
  const minted = await server.inject({
    method: "POST",
    url: "/v1/tokens",
    headers,
    payload: {
      name: "org-token",
      organizationId: "org-a",
      scopes: ["build:write"],
    },
  });
  assert.equal(minted.statusCode, 403);
  const worker = await server.inject({
    method: "POST",
    url: "/v1/workers",
    headers,
    payload: {
      name: "linux-1",
      organizationId: "org-a",
      platform: "android",
    },
  });
  assert.equal(worker.statusCode, 403);
});

test("worker lifecycle is tenant-scoped and persists heartbeat state", async (t) => {
  const manager = new TokenManager();
  const token = manager.create({
    name: "worker-control",
    organizationId: "org-a",
    scopes: ["worker:manage"],
  });
  const server = createApi({ tokenManager: manager });
  t.after(() => server.close());
  const headers = { authorization: `Bearer ${token.value}` };
  const created = await server.inject({
    method: "POST",
    url: "/v1/workers",
    headers,
    payload: {
      name: "linux-1",
      organizationId: "org-a",
      platform: "android",
    },
  });
  assert.equal(created.statusCode, 201);
  const worker = created.json() as { id: string; status: string };
  const heartbeat = await server.inject({
    method: "POST",
    url: `/v1/workers/${worker.id}/heartbeat`,
    headers,
  });
  assert.equal(heartbeat.statusCode, 200);
  assert.equal((heartbeat.json() as { status: string }).status, "ready");
  const foreign = await server.inject({
    method: "POST",
    url: "/v1/workers",
    headers,
    payload: {
      name: "linux-2",
      organizationId: "org-b",
      platform: "android",
    },
  });
  assert.equal(foreign.statusCode, 403);
});

test("worker reports require a bound worker token and matching platform", async (t) => {
  const manager = new TokenManager();
  const control = manager.create({
    name: "worker-control",
    organizationId: "org-a",
    scopes: ["worker:manage", "build:write"],
  });
  const server = createApi({ tokenManager: manager });
  t.after(() => server.close());
  const controlHeaders = {
    authorization: `Bearer ${control.value}`,
  };
  const createdWorker = await server.inject({
    method: "POST",
    url: "/v1/workers",
    headers: controlHeaders,
    payload: {
      name: "linux-1",
      organizationId: "org-a",
      platform: "android",
    },
  });
  const worker = createdWorker.json() as { id: string };
  const jobResponse = await server.inject({
    method: "POST",
    url: "/v1/builds",
    headers: controlHeaders,
    payload: {
      projectId: "project-a",
      organizationId: "org-a",
      platform: "android",
      profile: "production",
    },
  });
  const job = jobResponse.json() as { id: string };
  const loaded = await server.inject({
    method: "GET",
    url: `/v1/worker-builds/${job.id}`,
    headers: {
      authorization: `Bearer ${control.value}`,
      "x-lynxship-worker-id": worker.id,
    },
  });
  assert.equal(loaded.statusCode, 200);
  assert.equal((loaded.json() as { id: string }).id, job.id);
  const workerToken = manager.create({
    name: "linux-1-agent",
    organizationId: "org-a",
    workerId: worker.id,
    scopes: ["worker:report"],
  });
  const report = await server.inject({
    method: "POST",
    url: `/v1/builds/${job.id}/report`,
    headers: {
      authorization: `Bearer ${workerToken.value}`,
      "x-lynxship-worker-id": worker.id,
    },
    payload: { state: "uploading_source" },
  });
  assert.equal(report.statusCode, 200);
  assert.equal((report.json() as { state: string }).state, "uploading_source");

  const wrongWorker = await server.inject({
    method: "POST",
    url: `/v1/builds/${job.id}/report`,
    headers: {
      authorization: `Bearer ${workerToken.value}`,
      "x-lynxship-worker-id": "wrk_other",
    },
    payload: { state: "queued" },
  });
  assert.equal(wrongWorker.statusCode, 403);
});

test("bound workers upload binary artifacts only in the artifact stage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-worker-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manager = new TokenManager();
  const control = manager.create({
    name: "worker-control",
    organizationId: "org-a",
    scopes: ["worker:manage", "build:write"],
  });
  const server = createApi({
    tokenManager: manager,
    artifactRoot: join(root, "objects"),
  });
  t.after(() => server.close());
  const controlHeaders = { authorization: `Bearer ${control.value}` };
  const createdWorker = await server.inject({
    method: "POST",
    url: "/v1/workers",
    headers: controlHeaders,
    payload: {
      name: "linux-1",
      organizationId: "org-a",
      platform: "android",
    },
  });
  const worker = createdWorker.json() as { id: string };
  const workerToken = manager.create({
    name: "linux-1-agent",
    organizationId: "org-a",
    workerId: worker.id,
    scopes: ["worker:report"],
  });
  const jobResponse = await server.inject({
    method: "POST",
    url: "/v1/builds",
    headers: controlHeaders,
    payload: {
      projectId: "project-a",
      organizationId: "org-a",
      platform: "android",
      profile: "production",
    },
  });
  const job = jobResponse.json() as { id: string };
  const workerHeaders = {
    authorization: `Bearer ${workerToken.value}`,
    "x-lynxship-worker-id": worker.id,
  };
  for (const state of [
    "uploading_source",
    "queued",
    "provisioning",
    "installing_dependencies",
    "building",
    "signing",
    "uploading_artifacts",
  ] as const) {
    const response = await server.inject({
      method: "POST",
      url: `/v1/builds/${job.id}/report`,
      headers: workerHeaders,
      payload: { state },
    });
    assert.equal(response.statusCode, 200);
  }
  const artifact = await server.inject({
    method: "POST",
    url: `/v1/worker-builds/${job.id}/artifact`,
    headers: { ...workerHeaders, "content-type": "application/octet-stream" },
    payload: Buffer.from("signed apk bytes"),
  });
  assert.equal(artifact.statusCode, 201);
  const uploaded = artifact.json() as {
    artifact: { hash: string; size: number; key: string };
  };
  assert.equal(uploaded.artifact.hash, sha256("signed apk bytes"));
  assert.equal(uploaded.artifact.size, 16);
  assert.match(uploaded.artifact.key, /^sha256\/[a-f0-9]{64}$/);

  const terminal = await server.inject({
    method: "POST",
    url: `/v1/builds/${job.id}/report`,
    headers: workerHeaders,
    payload: { state: "success", artifact: uploaded.artifact },
  });
  assert.equal(terminal.statusCode, 200);
  assert.equal((terminal.json() as { state: string }).state, "success");
});

test("OTA API rolls a channel back to a compatible release", async (t) => {
  const server = createApi();
  t.after(() => server.close());
  const publish = async (message: string) =>
    server.inject({
      method: "POST",
      url: "/v1/ota/releases",
      payload: {
        projectId: "project",
        organizationId: "organization",
        channel: "production",
        platform: "android",
        runtimeVersion: "runtime-1",
        assets: [
          {
            path: "main.lynx.bundle",
            hash: sha256(message),
            size: message.length,
            url: "https://example.r2.dev/bundle",
          },
        ],
        message,
      },
    });
  const first = await publish("known-good");
  const second = await publish("bad-release");
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  const firstId = (first.json() as { id: string }).id;
  const rollback = await server.inject({
    method: "POST",
    url: "/v1/ota/rollback",
    payload: {
      projectId: "project",
      channel: "production",
      platform: "android",
      releaseId: firstId,
      reason: "Stop the bad release in production",
    },
  });
  assert.equal(rollback.statusCode, 200);
  assert.equal((rollback.json() as { id: string }).id, firstId);
  const check = await server.inject({
    method: "GET",
    url: "/v1/ota/check?projectId=project&channel=production&platform=android&runtimeVersion=runtime-1&installationId=device-1",
  });
  assert.equal((check.json() as { id: string }).id, firstId);
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
  const options = { buildExecutor: new LocalBuildExecutor() };
  const first = await loadPersistentApp(root, options);
  const token = first.app.auth.create({
    name: "persistent-ci",
    organizationId: "o",
    scopes: ["project:read"],
  });
  const job = await first.app.builds.create({
    projectId: "p",
    organizationId: "o",
    platform: "android",
    profile: "production",
  });
  await first.app.builds.run(job.id);
  await first.save();
  const second = await loadPersistentApp(root, options);
  assert.equal(second.app.builds.get(job.id).state, "success");
  assert.equal(
    second.app.auth.authenticate(token.value, { requiredScope: "project:read" })
      .name,
    "persistent-ci",
  );
});

test("persistent API does not use the deterministic local build executor", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-api-worker-"));
  const persistent = await loadPersistentApp(root);
  const job = await persistent.app.builds.create({
    projectId: "p",
    organizationId: "o",
    platform: "android",
    profile: "production",
  });
  try {
    await assert.rejects(
      () => persistent.app.builds.run(job.id),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "BUILD_EXECUTOR_REQUIRED",
    );
  } finally {
    await persistent.runtime.close();
  }
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

test("source upload and worker source read preserve an authenticated immutable snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-source-api-"));
  const projectRoot = join(root, "project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, "main.ts"), "export default 1;\n");
  const created = await createSourceSnapshot(projectRoot);
  const server = createApi({ artifactRoot: join(root, "objects") });
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const uploaded = await server.inject({
    method: "POST",
    url: "/v1/build-sources",
    payload: {
      projectId: "project-a",
      organizationId: "org-a",
      dataBase64: created.bytes.toString("base64"),
    },
  });
  assert.equal(uploaded.statusCode, 201);
  const source = uploaded.json().source as {
    key: string;
    hash: string;
    size: number;
    contentType: string;
    fileCount: number;
  };
  assert.deepEqual(
    { ...source, key: created.reference.key },
    created.reference,
  );
  assert.equal(source.key, "sha256/" + created.reference.hash);
  const worker = await server.inject({
    method: "POST",
    url: "/v1/workers",
    payload: {
      name: "android-source-reader",
      organizationId: "org-a",
      platform: "android",
    },
  });
  assert.equal(worker.statusCode, 201);
  const workerId = (worker.json() as { id: string }).id;
  const build = await server.inject({
    method: "POST",
    url: "/v1/builds",
    payload: {
      projectId: "project-a",
      organizationId: "org-a",
      platform: "android",
      profile: "production",
      source,
    },
  });
  assert.equal(build.statusCode, 201);
  const buildId = (build.json() as { id: string }).id;
  const downloaded = await server.inject({
    method: "GET",
    url: "/v1/worker-builds/" + buildId + "/source",
    headers: { "x-lynxship-worker-id": workerId },
  });
  assert.equal(downloaded.statusCode, 200);
  assert.equal(downloaded.headers["content-type"], source.contentType);
  assert.deepEqual(
    Uint8Array.from(downloaded.rawPayload),
    Uint8Array.from(created.bytes),
  );
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
