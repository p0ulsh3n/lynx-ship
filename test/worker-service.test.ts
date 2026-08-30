import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuild } from "@lynxship/build-orchestrator";
import { createSourceSnapshot } from "@lynxship/build-orchestrator";
import type { RedisQueue } from "@lynxship/queue";
import {
  BuildWorkerService,
  HttpWorkerArtifactUploader,
  HttpWorkerBuildLoader,
  HttpWorkerReporter,
  WorkerTransportError,
  createBuildWorkItem,
  parseBuildWorkItem,
} from "@lynxship/worker-service";

function queueStub(): RedisQueue {
  return {
    reclaim: async () => [],
    consume: async () => [],
    renewLease: async () => true,
    ack: async () => undefined,
  } as unknown as RedisQueue;
}

function job() {
  return createBuild({
    projectId: "project-a",
    organizationId: "org-a",
    platform: "android",
    profile: "production",
    sourceHash: "a".repeat(64),
  });
}

function reporter() {
  const reports: unknown[] = [];
  const heartbeats: string[] = [];
  return {
    reports,
    heartbeats,
    heartbeat: async ({ workerId }: { workerId: string }) => {
      heartbeats.push(workerId);
    },
    report: async (request: unknown) => {
      reports.push(request);
    },
  };
}

test("worker service validates immutable work identity before executing", async () => {
  const build = job();
  const reports = reporter();
  let executed = false;
  const service = new BuildWorkerService({
    queue: queueStub(),
    queueName: "builds",
    worker: { id: "worker-a", organizationId: "org-a", platform: "android" },
    reporter: reports,
    loadBuild: async () => build,
    executor: {
      execute: async () => {
        executed = true;
        return {};
      },
    },
  });
  const forged = { ...createBuildWorkItem(build), profile: "staging" };
  await assert.rejects(
    service.process(forged, { messageId: "1-0", workerId: "worker-a" }),
    { code: "WORK_ITEM_INVALID" },
  );
  assert.equal(executed, false);
});

test("worker service reports executor-owned lifecycle and terminal success", async () => {
  const build = job();
  const reports = reporter();
  const service = new BuildWorkerService({
    queue: queueStub(),
    queueName: "builds",
    worker: { id: "worker-a", organizationId: "org-a", platform: "android" },
    reporter: reports,
    loadBuild: async () => build,
    executor: {
      execute: async (_job, context) => {
        for (const state of [
          "uploading_source",
          "queued",
          "provisioning",
          "installing_dependencies",
          "building",
          "signing",
          "uploading_artifacts",
          "success",
        ] as const)
          await context.report({ state });
        return { artifact: { name: "app.apk", hash: "b".repeat(64) } };
      },
    },
  });
  const result = await service.process(createBuildWorkItem(build), {
    messageId: "1-0",
    workerId: "worker-a",
  });
  assert.equal(result.artifact?.name, "app.apk");
  assert.equal(reports.reports.length, 8);
  assert.equal(
    (reports.reports.at(-1) as { report: { state: string } }).report.state,
    "success",
  );
});

test("worker execution context publishes artifacts through the bound uploader", async () => {
  const build = job();
  const reports = reporter();
  let uploaded = "";
  const service = new BuildWorkerService({
    queue: queueStub(),
    queueName: "builds",
    worker: { id: "worker-a", organizationId: "org-a", platform: "android" },
    reporter: reports,
    loadBuild: async () => build,
    uploadArtifact: async (buildId, workerId, content, contentType) => {
      assert.equal(buildId, build.id);
      assert.equal(workerId, "worker-a");
      assert.equal(contentType, "application/vnd.android.package-archive");
      uploaded = content.toString();
      return {
        name: "app.apk",
        hash: "b".repeat(64),
        size: content.length,
        contentType,
      };
    },
    executor: {
      execute: async (_job, context) => {
        await context.report({ state: "uploading_source" });
        await context.report({ state: "queued" });
        await context.report({ state: "provisioning" });
        await context.report({ state: "installing_dependencies" });
        await context.report({ state: "building" });
        await context.report({ state: "signing" });
        await context.report({ state: "uploading_artifacts" });
        const artifact = await context.uploadArtifact!(
          Buffer.from("apk"),
          "application/vnd.android.package-archive",
        );
        await context.report({ state: "success", artifact });
        return { artifact };
      },
    },
  });
  const result = await service.process(createBuildWorkItem(build), {
    messageId: "artifact-1",
    workerId: "worker-a",
  });
  assert.equal(uploaded, "apk");
  assert.equal(result.artifact?.name, "app.apk");
  assert.equal(
    (reports.reports.at(-1) as { report: { state: string } }).report.state,
    "success",
  );
});

test("worker service verifies and exposes an immutable source snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-worker-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "main.ts"), "export default 1;\n");
  const source = await createSourceSnapshot(root);
  const build = createBuild({
    projectId: "project-a",
    organizationId: "org-a",
    platform: "android",
    profile: "production",
    source: source.reference,
  });
  const reports = reporter();
  let loaded = false;
  let workspacePath = "";
  const service = new BuildWorkerService({
    queue: queueStub(),
    queueName: "builds",
    worker: { id: "worker-a", organizationId: "org-a", platform: "android" },
    reporter: reports,
    loadBuild: async () => build,
    loadSource: async (reference) => {
      loaded = reference.hash === source.reference.hash;
      return source.bytes;
    },
    executor: {
      execute: async (_job, context) => {
        assert.equal(context.source?.snapshot.files[0]?.path, "main.ts");
        workspacePath = context.sourceWorkspace ?? "";
        assert.ok(workspacePath);
        assert.equal(
          await readFile(join(workspacePath, "main.ts"), "utf8"),
          "export default 1;\n",
        );
        await context.report({ state: "success" });
        return {};
      },
    },
  });
  await service.process(createBuildWorkItem(build), {
    messageId: "source-1",
    workerId: "worker-a",
  });
  assert.equal(loaded, true);
  assert.equal(reports.reports.length, 1);
  await assert.rejects(readFile(join(workspacePath, "main.ts")));
});

test("worker service fails closed when a source loader is absent", async () => {
  const build = createBuild({
    projectId: "project-a",
    organizationId: "org-a",
    platform: "android",
    profile: "production",
    source: {
      key: "sources/" + "a".repeat(64),
      hash: "a".repeat(64),
      size: 1,
      contentType: "application/vnd.lynxship.source-snapshot+json",
      fileCount: 0,
    },
  });
  const missingReports = reporter();
  const missing = new BuildWorkerService({
    queue: queueStub(),
    queueName: "builds",
    worker: { id: "worker-a", organizationId: "org-a", platform: "android" },
    reporter: missingReports,
    loadBuild: async () => build,
    executor: { execute: async () => ({}) },
  });
  await missing.process(createBuildWorkItem(build), {
    messageId: "source-2",
    workerId: "worker-a",
  });
  assert.equal(
    (missingReports.reports[0] as { report: { reason: string } }).report.reason,
    "This build references a source snapshot but no source loader is configured",
  );
});

test("worker service fails closed on platform mismatch and missing terminal report", async () => {
  const build = job();
  const reports = reporter();
  const mismatch = new BuildWorkerService({
    queue: queueStub(),
    queueName: "builds",
    worker: { id: "worker-ios", organizationId: "org-a", platform: "ios" },
    reporter: reports,
    loadBuild: async () => build,
    executor: { execute: async () => ({}) },
  });
  await assert.rejects(
    mismatch.process(createBuildWorkItem(build), {
      messageId: "1-0",
      workerId: "worker-ios",
    }),
    { code: "WORKER_PLATFORM_MISMATCH" },
  );

  const incompleteBuild = job();
  const incompleteReports = reporter();
  const incomplete = new BuildWorkerService({
    queue: queueStub(),
    queueName: "builds",
    worker: { id: "worker-a", organizationId: "org-a", platform: "android" },
    reporter: incompleteReports,
    loadBuild: async () => incompleteBuild,
    executor: { execute: async () => ({}) },
  });
  await incomplete.process(createBuildWorkItem(incompleteBuild), {
    messageId: "1-1",
    workerId: "worker-a",
  });
  assert.equal(
    (incompleteReports.reports[0] as { report: { state: string } }).report
      .state,
    "failed",
  );
});

test("worker service does not execute a duplicated terminal build", async () => {
  const build = job();
  build.state = "success";
  const reports = reporter();
  let executed = false;
  const service = new BuildWorkerService({
    queue: queueStub(),
    queueName: "builds",
    worker: { id: "worker-a", organizationId: "org-a", platform: "android" },
    reporter: reports,
    loadBuild: async () => build,
    executor: {
      execute: async () => {
        executed = true;
        return {};
      },
    },
  });
  const result = await service.process(createBuildWorkItem(build), {
    messageId: "1-0",
    workerId: "worker-a",
  });
  assert.deepEqual(result, { logs: [] });
  assert.equal(executed, false);
  assert.equal(reports.reports.length, 0);
});

test("worker service stops after repeated heartbeat failures", async () => {
  const build = job();
  let heartbeatCount = 0;
  const service = new BuildWorkerService({
    queue: {
      reclaim: async () => [],
      consume: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [];
      },
      renewLease: async () => true,
      ack: async () => undefined,
    } as unknown as RedisQueue,
    queueName: "builds",
    worker: { id: "worker-a", organizationId: "org-a", platform: "android" },
    reporter: {
      heartbeat: async () => {
        heartbeatCount += 1;
        if (heartbeatCount > 1) throw new Error("control plane unavailable");
      },
      report: async () => undefined,
    },
    loadBuild: async () => build,
    executor: { execute: async () => ({}) },
    heartbeatIntervalMs: 1_000,
    heartbeatFailureThreshold: 1,
    blockMs: 0,
  });
  const started = service.start();
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await started;
  assert.equal(service.status, "stopped");
  assert.equal(heartbeatCount, 2);
});

test("HTTP worker reporter enforces HTTPS and keeps credentials out of URLs", async () => {
  assert.throws(
    () =>
      new HttpWorkerReporter({
        baseUrl: "http://example.test",
        token: "secret",
      }),
    { code: "WORKER_ENDPOINT" },
  );
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const reporter = new HttpWorkerReporter({
    baseUrl: "https://control.example.test/",
    token: "secret-token",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response("ok", { status: 200 });
    },
  });
  await reporter.report({
    workerId: "worker-a",
    buildId: "build/a",
    reportId: "worker-a:build/a:1",
    report: { state: "success" },
  });
  assert.equal(
    requests[0]?.url,
    "https://control.example.test/v1/builds/build%2Fa/report",
  );
  assert.equal(requests[0]?.url.includes("secret-token"), false);
  assert.equal(
    (requests[0]?.init.headers as Record<string, string>).authorization,
    "Bearer secret-token",
  );
});

test("HTTP worker reporter bounds transport failures", async () => {
  const reporter = new HttpWorkerReporter({
    baseUrl: "https://control.example.test",
    token: "secret",
    fetchImpl: async () => new Response("x".repeat(5_000), { status: 503 }),
  });
  await assert.rejects(
    reporter.heartbeat({ workerId: "worker-a" }),
    (error: unknown) =>
      error instanceof WorkerTransportError &&
      error.status === 503 &&
      error.message.length < 700,
  );
});

test("HTTP worker build loader uses the worker-only route and header", async () => {
  const build = job();
  let requestedUrl = "";
  let requestedWorker = "";
  const loader = new HttpWorkerBuildLoader({
    baseUrl: "https://control.example.test",
    token: "secret",
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedWorker = String(
        (init?.headers as Record<string, string>)["x-lynxship-worker-id"],
      );
      return new Response(JSON.stringify(build), { status: 200 });
    },
  });
  const loaded = await loader.load("build/a", "worker-a");
  assert.equal(loaded?.id, build.id);
  assert.equal(
    requestedUrl,
    "https://control.example.test/v1/worker-builds/build%2Fa",
  );
  assert.equal(requestedWorker, "worker-a");
});

test("HTTP worker artifact uploader sends binary bytes with worker identity", async () => {
  let requestedUrl = "";
  let requestedMethod = "";
  let requestedBody = "";
  let requestedHeaders: Record<string, string> = {};
  const uploader = new HttpWorkerArtifactUploader({
    baseUrl: "https://control.example.test",
    token: "secret",
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? "";
      requestedHeaders = Object.fromEntries(
        new Headers(init?.headers).entries(),
      );
      requestedBody = Buffer.from(
        (init?.body as Uint8Array<ArrayBuffer>) ?? new Uint8Array(),
      ).toString();
      return new Response(
        JSON.stringify({
          artifact: {
            name: "app.apk",
            hash: "a".repeat(64),
            size: 3,
            contentType: "application/octet-stream",
          },
        }),
        { status: 201 },
      );
    },
  });
  const artifact = await uploader.upload(
    "build/a",
    "worker-a",
    Buffer.from("apk"),
  );
  assert.equal(artifact.name, "app.apk");
  assert.equal(requestedMethod, "POST");
  assert.equal(
    requestedUrl,
    "https://control.example.test/v1/worker-builds/build%2Fa/artifact",
  );
  assert.equal(requestedBody, "apk");
  assert.equal(requestedHeaders.authorization, "Bearer secret");
  assert.equal(requestedHeaders["x-lynxship-worker-id"], "worker-a");
  assert.equal(requestedHeaders["content-type"], "application/octet-stream");
});

test("work item parser rejects legacy or unsupported payloads", () => {
  assert.throws(() => parseBuildWorkItem({ buildId: "only-id" }), {
    code: "WORK_ITEM_INVALID",
  });
  assert.throws(
    () =>
      parseBuildWorkItem({
        schemaVersion: 1,
        buildId: "b",
        projectId: "p",
        organizationId: "o",
        platform: "android",
        profile: "production",
        sourceHash: "not-a-hash",
      }),
    { code: "WORK_ITEM_INVALID" },
  );
});
