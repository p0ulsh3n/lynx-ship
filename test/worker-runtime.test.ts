import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuild } from "@lynxship/build-orchestrator";
import type { RedisQueue } from "@lynxship/queue";
import {
  createCliWorkerExecutor,
  createHostedWorkerService,
  loadHostedWorkerConfig,
} from "@lynxship/worker-runtime";

test("hosted worker config is explicit and HTTPS-first", () => {
  const config = loadHostedWorkerConfig({
    LYNXSHIP_API_URL: "https://control.example.test/",
    LYNXSHIP_WORKER_TOKEN: "worker-secret",
    LYNXSHIP_WORKER_ID: "worker-a",
    LYNXSHIP_WORKER_ORGANIZATION_ID: "org-a",
    LYNXSHIP_WORKER_PLATFORM: "android",
    REDIS_URL: "redis://redis:6379",
  });
  assert.equal(config.apiUrl, "https://control.example.test");
  assert.equal(config.platform, "android");
  assert.equal(config.queueName, "builds");
  assert.throws(
    () =>
      loadHostedWorkerConfig({
        LYNXSHIP_API_URL: "http://control.example.test",
        LYNXSHIP_WORKER_TOKEN: "secret",
        LYNXSHIP_WORKER_ID: "worker-a",
        LYNXSHIP_WORKER_ORGANIZATION_ID: "org-a",
        LYNXSHIP_WORKER_PLATFORM: "ios",
        REDIS_URL: "redis://redis:6379",
      }),
    { code: "WORKER_ENDPOINT" },
  );
});

test("hosted worker composition binds queue, tenant and platform to the service", () => {
  const config = loadHostedWorkerConfig({
    LYNXSHIP_API_URL: "https://control.example.test",
    LYNXSHIP_WORKER_TOKEN: "secret",
    LYNXSHIP_WORKER_ID: "worker-ios",
    LYNXSHIP_WORKER_ORGANIZATION_ID: "org-a",
    LYNXSHIP_WORKER_PLATFORM: "ios",
    REDIS_URL: "redis://redis:6379",
    LYNXSHIP_QUEUE_NAME: "mobile-builds",
  });
  const queue = {} as RedisQueue;
  const service = createHostedWorkerService(
    config,
    {
      execute: async () => ({}),
    },
    {
      queue,
      reporter: {
        heartbeat: async () => undefined,
        report: async () => undefined,
      },
      loadBuild: async () => null,
      loadSource: async () => Buffer.from(""),
      uploadArtifact: async () => ({ name: "artifact", hash: "a".repeat(64) }),
    },
  );
  assert.equal(service.options.worker.id, "worker-ios");
  assert.equal(service.options.worker.organizationId, "org-a");
  assert.equal(service.options.worker.platform, "ios");
  assert.equal(service.options.queueName, "mobile-builds");
});

test("CLI worker executor runs the fixed build command and uploads the discovered artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-cli-worker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactPath = join(root, ".lynxship", "artifacts", "app.apk");
  await mkdir(join(root, ".lynxship", "artifacts"), { recursive: true });
  await writeFile(artifactPath, "signed apk");
  const job = createBuild({
    projectId: "project-a",
    organizationId: "org-a",
    platform: "android",
    profile: "production",
  });
  await writeFile(
    join(root, ".lynxship", "state.json"),
    JSON.stringify({
      builds: [
        {
          ...job,
          id: "local-child-build",
          state: "success",
          artifact: {
            name: "app.apk",
            hash: "a".repeat(64),
            path: artifactPath,
          },
        },
      ],
    }),
  );
  const calls: Array<{
    executable: string;
    args: readonly string[];
    cwd: string;
  }> = [];
  const reports: string[] = [];
  let uploaded = "";
  const executor = createCliWorkerExecutor({
    cliEntry: "/opt/lynxship-cli/index.js",
    runner: async (executable, args, cwd) => {
      calls.push({ executable, args, cwd });
      return { code: 0, stdout: "{}", stderr: "" };
    },
  });
  const result = await executor.execute(job, {
    workerId: "worker-a",
    messageId: "message-a",
    signal: new AbortController().signal,
    report: async ({ state, artifact }) => {
      reports.push(state);
      if (state === "success") assert.equal(artifact?.name, "app.apk");
    },
    sourceWorkspace: root,
    uploadArtifact: async (content, contentType) => {
      uploaded = `${content.toString()}|${contentType}`;
      return {
        name: "app.apk",
        hash: "b".repeat(64),
        size: content.length,
        contentType,
      };
    },
  });
  assert.equal(result.artifact?.hash, "b".repeat(64));
  assert.deepEqual(reports, [
    "uploading_source",
    "queued",
    "provisioning",
    "installing_dependencies",
    "building",
    "signing",
    "uploading_artifacts",
    "success",
  ]);
  assert.equal(uploaded, "signed apk|application/vnd.android.package-archive");
  assert.equal(calls[0]?.executable, process.execPath);
  assert.deepEqual(calls[0]?.args, [
    "/opt/lynxship-cli/index.js",
    "build",
    "--platform",
    "android",
    "--profile",
    "production",
    "--no-upload",
    "--non-interactive",
    "--json",
  ]);
  assert.equal(calls[0]?.cwd, root);
});
