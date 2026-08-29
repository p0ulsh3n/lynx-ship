import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, hashJson } from "@lynxship/contracts";
import { validateConfig, resolveProfile } from "@lynxship/cli/config";
import {
  assertCompatibleBinaryBuild,
  inspectRuntimeFingerprint,
} from "@lynxship/cli/runtime-fingerprint";
import { inspectAutolink, requireAutolinkReady } from "@lynxship/cli/autolink";
import { TokenManager, scopesForRole } from "@lynxship/auth";
import {
  transitionBuild,
  BuildService,
  runtimeFingerprint,
  BuildCache,
  createSourceManifest,
} from "@lynxship/build-orchestrator";
import {
  createSigningKey,
  createManifest,
  signManifest,
  verifyManifest,
  OtaService,
  createDelta,
  applyDelta,
  OtaClient,
  verifyAsset,
  Keyring,
} from "@lynxship/signing";
import { RedisWorkerRuntime, WorkerRegistry } from "@lynxship/worker-agent";
import type { RedisQueue } from "@lynxship/queue";
import {
  SubmissionService,
  GooglePlayProvider,
  AppStoreConnectProvider,
  GooglePlayApiProvider,
  AppStoreConnectApiProvider,
} from "@lynxship/submit";
import {
  UsageLedger,
  SecretVault,
  TenantDirectory,
  TelemetryStore,
  shouldPauseRollout,
  WebhookService,
  redact,
  pruneExpired,
  DeviceRegistry,
  ProviderCatalog,
  AuditLog,
  LimitPolicy,
  FixedWindowRateLimiter,
} from "@lynxship/api";
import { LeaseQueue } from "@lynxship/queue";
import { validatePresignedAccess } from "@lynxship/storage";
import {
  createBackup,
  restoreBackup,
  validateMigrationNames,
  MigrationTracker,
} from "@lynxship/db";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("canonical JSON is stable regardless of object insertion order", () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(hashJson({ a: 1, b: 2 }), hashJson({ b: 2, a: 1 }));
});
test("configuration validates profiles and rejects unknown CI keys", () => {
  const config = validateConfig(
    { projectId: "p", build: { production: { distribution: "store" } } },
    { ci: true },
  );
  assert.equal(resolveProfile(config).name, "production");
  assert.throws(() => validateConfig({ unexpected: true }, { ci: true }), {
    code: "CONFIG_UNKNOWN_KEY",
  });
});

test("simulator profile inherits the generated iOS host settings", () => {
  const config = validateConfig({
    projectId: "p",
    build: {
      production: {
        ios: {
          project: "ios/Test.xcodeproj",
          scheme: "Test",
          exportOptionsPlist: "ios/ExportOptions.plist",
        },
      },
    },
  });
  const simulator = resolveProfile(config, "simulator");
  assert.equal(simulator.ios?.simulator, true);
  assert.equal(simulator.ios?.configuration, "Debug");
  assert.equal(simulator.ios?.scheme, "Test");
  assert.equal(simulator.ios?.exportOptionsPlist, "ios/ExportOptions.plist");
});
test("runtime fingerprint changes with native code and Lynx autolink manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-runtime-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@11",
      devDependencies: { "@lynx-js/react": "^0.12.0" },
    }),
  );
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await mkdir(join(root, "android", "app"), { recursive: true });
  await writeFile(join(root, "android", "app", "build.gradle"), "android {}\n");
  await writeFile(join(root, "lynx.lib.json"), JSON.stringify({ modules: [] }));
  const config = validateConfig({ runtimeVersion: { policy: "fingerprint" } });
  const first = await inspectRuntimeFingerprint(root, "android", config);
  await writeFile(
    join(root, "android", "app", "build.gradle"),
    "android { namespace 'x' }\n",
  );
  const second = await inspectRuntimeFingerprint(root, "android", config);
  assert.notEqual(first.value, second.value);
  await writeFile(
    join(root, "lynx.lib.json"),
    JSON.stringify({ modules: ["camera"] }),
  );
  const third = await inspectRuntimeFingerprint(root, "android", config);
  assert.notEqual(second.value, third.value);
});
test("OTA compatibility requires a successful binary with the same runtime fingerprint", async () => {
  const builds = new BuildService();
  const job = await builds.create({
    projectId: "p",
    organizationId: "o",
    platform: "android",
    profile: "production",
    runtimeVersion: "fp-compatible",
  });
  await builds.run(job.id);
  assert.doesNotThrow(() =>
    assertCompatibleBinaryBuild(builds, "android", "fp-compatible"),
  );
  assert.throws(
    () => assertCompatibleBinaryBuild(builds, "android", "fp-changed"),
    { code: "OTA_NATIVE_CHANGE_REQUIRED" },
  );
});
test("Autolink requires the official host plugins when a Lynx native library is installed", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-autolink-"));
  const library = join(root, "node_modules", "@example", "native-camera");
  await mkdir(library, { recursive: true });
  await writeFile(
    join(library, "lynx.lib.json"),
    JSON.stringify({
      platforms: { android: { packageName: "example.camera" } },
    }),
  );
  await mkdir(join(library, "android"), { recursive: true });
  await mkdir(join(root, "android", "app"), { recursive: true });
  await writeFile(
    join(root, "android", "settings.gradle"),
    "rootProject.name = 'x'\n",
  );
  await writeFile(
    join(root, "android", "app", "build.gradle"),
    "plugins { id 'com.android.application' }\n",
  );
  const blocked = await inspectAutolink(root);
  assert.equal(blocked.android.required, true);
  assert.equal(blocked.android.ready, false);
  await assert.rejects(requireAutolinkReady(root, "android"), {
    code: "LYNX_AUTOLINK_ANDROID_REQUIRED",
  });
  await writeFile(
    join(root, "android", "settings.gradle"),
    "plugins { id 'org.lynxsdk.library-settings' }\n",
  );
  await writeFile(
    join(root, "android", "app", "build.gradle"),
    "plugins { id 'org.lynxsdk.library-build' }\n",
  );
  const ready = await inspectAutolink(root);
  assert.equal(ready.android.ready, true);
});

test("Autolink validates native source directories and duplicate capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-autolink-duplicates-"));
  const first = join(root, "node_modules", "@example", "first");
  const second = join(root, "node_modules", "@example", "second");
  for (const library of [first, second]) {
    await mkdir(join(library, "android"), { recursive: true });
    await writeFile(
      join(library, "lynx.lib.json"),
      JSON.stringify({
        platforms: { android: { packageName: "example.library" } },
      }),
    );
    await writeFile(
      join(library, "android", "Module.java"),
      '@LynxNativeModule("SharedModule")\nclass Module {}\n',
    );
  }
  await mkdir(join(root, "android", "app"), { recursive: true });
  await writeFile(
    join(root, "android", "settings.gradle"),
    "plugins { id 'org.lynxsdk.library-settings' }\n",
  );
  await writeFile(
    join(root, "android", "app", "build.gradle"),
    "plugins { id 'org.lynxsdk.library-build' }\n",
  );
  const status = await inspectAutolink(root);
  assert.equal(status.android.ready, false);
  assert.match(status.android.reason, /duplicate android native capability/);
});
test("tokens are shown once, scoped and revocable", () => {
  const manager = new TokenManager();
  const created = manager.create({
    name: "ci",
    organizationId: "org",
    scopes: ["build:write"],
  });
  assert.equal(
    manager.authenticate(created.value, { requiredScope: "build:write" }).id,
    created.id,
  );
  assert.throws(
    () =>
      manager.authenticate(created.value, { requiredScope: "update:write" }),
    { code: "AUTH_SCOPE" },
  );
  manager.revoke(created.id);
  assert.throws(() => manager.authenticate(created.value), {
    code: "AUTH_REVOKED",
  });
  assert.deepEqual(scopesForRole("viewer"), ["project:read"]);
});
test("build state machine completes and rejects invalid transitions", async () => {
  const service = new BuildService();
  const job = await service.create({
    projectId: "p",
    organizationId: "o",
    platform: "android",
    profile: "production",
  });
  assert.throws(() => transitionBuild(job, "success"), {
    code: "BUILD_TRANSITION_INVALID",
  });
  const result = await service.run(job.id);
  assert.equal(result.state, "success");
  assert.equal(result.transitions.at(-1)?.state, "success");
});
test("Ed25519 signatures cover canonical OTA manifests", () => {
  const keys = createSigningKey();
  const manifest = createManifest({
    projectId: "p",
    channel: "production",
    platform: "android",
    runtimeVersion: "fp-1",
    sequence: 1,
    keyId: keys.keyId,
    assets: [{ path: "main.js", data: "hello" }],
  });
  const signature = signManifest(manifest, keys.privateKey);
  assert.equal(verifyManifest(manifest, signature, keys.publicKey), true);
  assert.equal(
    verifyManifest({ ...manifest, sequence: 2 }, signature, keys.publicKey),
    false,
  );
});
test("OTA manifests bind the immutable bundle URL", () => {
  const keys = createSigningKey();
  const manifest = createManifest({
    projectId: "p",
    channel: "production",
    platform: "android",
    runtimeVersion: "fp-1",
    sequence: 1,
    keyId: keys.keyId,
    assets: [
      {
        path: "main.lynx.bundle",
        data: "hello",
        url: "https://account.r2.cloudflarestorage.com/signed-bundle",
      },
    ],
  });
  const signature = signManifest(manifest, keys.privateKey);
  assert.equal(manifest.assets[0]?.url?.startsWith("https://"), true);
  assert.equal(verifyManifest(manifest, signature, keys.publicKey), true);
});
test("OTA policy blocks native executable and requires iOS approval", () => {
  const service = new OtaService();
  assert.throws(
    () =>
      service.publish({
        projectId: "p",
        channel: "production",
        platform: "ios",
        runtimeVersion: "fp-1",
        assets: [{ path: "main.js", data: "x" }],
      }),
    { code: "OTA_POLICY_REVIEW" },
  );
  const release = service.publish({
    projectId: "p",
    channel: "production",
    platform: "android",
    runtimeVersion: "fp-1",
    assets: [{ path: "main.js", data: "x" }],
    message: "fix",
  });
  assert.equal(
    service.check({
      projectId: "p",
      channel: "production",
      platform: "android",
      runtimeVersion: "fp-1",
      installationId: "device-1",
    })?.id,
    release.id,
  );
  service.rollback({
    projectId: "p",
    channel: "production",
    releaseId: release.id,
    reason: "test rollback",
  });
  assert.equal(service.promote(release.id, 50).rollout, 50);
  assert.equal(service.resume(service.pause(release.id).id).paused, false);
});
test("runtime fingerprint changes when native inputs change", () => {
  const first = runtimeFingerprint({
    platform: "android",
    config: { update: { protocolVersion: 1 } },
    native: { androidApi: 35 },
  });
  const second = runtimeFingerprint({
    platform: "android",
    config: { update: { protocolVersion: 1 } },
    native: { androidApi: 36 },
  });
  assert.notEqual(first.value, second.value);
});
test("workers support heartbeat, draining and revocation", () => {
  const registry = new WorkerRegistry();
  const worker = registry.register({
    name: "linux-1",
    organizationId: "o",
    platform: "android",
    capabilities: { jdk: 17 },
  });
  assert.equal(registry.heartbeat(worker.id).status, "ready");
  assert.equal(registry.drain(worker.id).status, "draining");
  registry.revoke(worker.id);
  assert.throws(() => registry.heartbeat(worker.id), {
    code: "WORKER_REVOKED",
  });
});
test("workers are marked offline only after their heartbeat lease expires", () => {
  const registry = new WorkerRegistry();
  const worker = registry.register({
    name: "macos-1",
    organizationId: "o",
    platform: "ios",
  });
  worker.lastHeartbeatAt = new Date(100_000).toISOString();
  assert.deepEqual(registry.markOffline(189_999, 90_000), []);
  assert.equal(registry.markOffline(190_000, 90_000)[0]?.status, "offline");
});
test("worker runtime acknowledges only after the handler succeeds", async () => {
  const acknowledgements: string[] = [];
  let delivered = false;
  const fakeQueue = {
    reclaim: async () => [],
    consume: async () => {
      if (delivered) return [];
      delivered = true;
      return [{ id: "1-0", payload: { buildId: "build-1" } }];
    },
    ack: async (_queue: string, id: string) => acknowledgements.push(id),
  } as unknown as RedisQueue;
  const runtime = new RedisWorkerRuntime({
    queue: fakeQueue,
    queueName: "builds",
    workerId: "worker-1",
    blockMs: 0,
  });
  await runtime.run(async (_payload) => runtime.stop());
  assert.deepEqual(acknowledgements, ["1-0"]);
});
test("submission requires hashed artifacts and usage is immutable", async () => {
  const submissions = new SubmissionService();
  const job = await submissions.submit({
    projectId: "p",
    organizationId: "o",
    platform: "android",
    artifact: { hash: "abc" },
  });
  assert.equal(job.status, "submitted");
  const ledger = new UsageLedger();
  const record = ledger.record({
    organizationId: "o",
    platform: "android",
    minutes: 4,
  });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(ledger.total("o", "android"), 4);
  await assert.rejects(
    () =>
      submissions.submit({
        projectId: "p",
        organizationId: "o",
        platform: "android",
        artifact: { hash: "abc" },
        buildId: "b",
        path: "a.aab",
      }),
    { code: "SUBMISSION_SOURCE" },
  );
  const first = await submissions.submit({
    projectId: "p",
    organizationId: "o",
    platform: "android",
    artifact: { hash: "abc" },
    idempotencyKey: "same",
  });
  const second = await submissions.submit({
    projectId: "p",
    organizationId: "o",
    platform: "android",
    artifact: { hash: "abc" },
    idempotencyKey: "same",
  });
  assert.equal(first.id, second.id);
  const google = new GooglePlayProvider(async (request) => ({
    remoteId: String(request.endpoint),
    status: "accepted",
  }));
  assert.equal(
    (
      await google.submit({
        platform: "android",
        applicationId: "com.example",
        track: "internal",
        artifact: { hash: "x" },
      })
    ).status,
    "accepted",
  );
  const asc = new AppStoreConnectProvider(async (request) => ({
    remoteId: String(request.endpoint),
    status: "processing",
  }));
  assert.equal(
    (
      await asc.submit({
        platform: "ios",
        bundleIdentifier: "com.example",
        ascAppId: "1",
        artifact: { hash: "x" },
      })
    ).status,
    "processing",
  );
});
test("real store providers upload signed artifacts through official flows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lynxship-store-"));
  const androidArtifact = join(directory, "release.aab");
  const iosArtifact = join(directory, "release.ipa");
  await writeFile(androidArtifact, "android-binary");
  await writeFile(iosArtifact, "ios-binary");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serviceAccount = JSON.stringify({
    client_email: "lynxship-test@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  const googleCalls: string[] = [];
  const google = new GooglePlayApiProvider(
    {
      serviceAccountJson: serviceAccount,
      applicationId: "com.example.app",
      track: "internal",
      releaseStatus: "draft",
    },
    {
      fetchImpl: async (input) => {
        const url = String(input);
        googleCalls.push(url);
        if (url.includes("oauth2.googleapis.com"))
          return new Response(JSON.stringify({ access_token: "test-token" }), {
            status: 200,
          });
        if (url.endsWith("/edits"))
          return new Response(JSON.stringify({ id: "edit-1" }), {
            status: 200,
          });
        if (url.includes("/bundles"))
          return new Response(JSON.stringify({ versionCode: 42 }), {
            status: 200,
          });
        if (url.includes("/tracks/"))
          return new Response(JSON.stringify({ track: "internal" }), {
            status: 200,
          });
        if (url.endsWith(":commit"))
          return new Response(JSON.stringify({ id: "edit-1" }), {
            status: 200,
          });
        return new Response("not found", { status: 404 });
      },
    },
  );
  const googleResult = await google.submit({
    platform: "android",
    path: androidArtifact,
  });
  assert.equal(googleResult.status, "submitted");
  assert.equal(googleCalls.filter((url) => url.endsWith("/edits")).length, 1);
  assert.equal(
    googleCalls.some((url) => url.includes("/bundles")),
    true,
  );
  assert.equal(
    googleCalls.some((url) => url.includes("/tracks/internal")),
    true,
  );
  assert.equal(
    googleCalls.some((url) => url.endsWith(":commit")),
    true,
  );

  const appleKey = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  let transporterCwd = "";
  const apple = new AppStoreConnectApiProvider(
    {
      apiKeyId: "TESTKEY123",
      issuerId: "issuer-1",
      privateKey: appleKey,
      bundleIdentifier: "com.example.app",
    },
    {
      runner: async (_executable, args, cwd) => {
        transporterCwd = cwd;
        assert.deepEqual(args, [
          "-m",
          "upload",
          "-apiIssuer",
          "issuer-1",
          "-apiKey",
          "TESTKEY123",
          "-assetFile",
          iosArtifact,
        ]);
        await access(join(cwd, "private_keys", "AuthKey_TESTKEY123.p8"));
        return { output: "uploaded", code: 0 };
      },
    },
  );
  const appleResult = await apple.submit({
    platform: "ios",
    path: iosArtifact,
  });
  assert.equal(appleResult.status, "uploaded");
  assert.equal(transporterCwd.length > 0, true);
});
test("queue leases recover and dead-letter after retry limit", () => {
  const queue = new LeaseQueue<{ buildId: string }>();
  const item = queue.enqueue({ buildId: "b" }, { maxAttempts: 1 });
  queue.lease("worker", Date.now());
  queue.recoverExpired(Date.now() + 31_000);
  assert.equal(queue.get(item.id).status, "dead");
});
test("vault encrypts secrets and inspection is redacted", () => {
  const vault = new SecretVault("test-master-key");
  const safe = vault.put({
    organizationId: "o",
    name: "google",
    value: "do-not-log",
    type: "store",
  });
  assert.equal(vault.read(safe.id), "do-not-log");
  assert.equal(safe.redacted, true);
  assert.equal(JSON.stringify(safe).includes("do-not-log"), false);
});
test("tenant directory applies role and project ownership rules", () => {
  const tenants = new TenantDirectory();
  const org = tenants.createOrganization("Acme", "u1");
  const project = tenants.createProject(org.id, "App");
  assert.equal(
    tenants.authorize({
      organizationId: org.id,
      userId: "u1",
      projectId: project.id,
      scope: "update:write",
    }).role,
    "owner",
  );
  tenants.addMember(org.id, "u2", "viewer");
  assert.throws(
    () =>
      tenants.authorize({
        organizationId: org.id,
        userId: "u2",
        projectId: project.id,
        scope: "build:write",
      }),
    { code: "FORBIDDEN" },
  );
});
test("delta updates fall back to full content when the patch is too large", () => {
  const delta = createDelta(
    { data: "abc" },
    { data: "xyz" },
    { maxPatchRatio: 0.5 },
  );
  assert.equal(delta.type, "full");
  assert.equal(applyDelta({ data: "abc" }, delta), "xyz");
  const small = createDelta(
    { data: "hello world" },
    { data: "hello brave world" },
  );
  assert.equal(applyDelta({ data: "hello world" }, small), "hello brave world");
});
test("telemetry detects a bad rollout and webhooks sign exact bodies", () => {
  const telemetry = new TelemetryStore();
  for (let i = 0; i < 20; i += 1)
    telemetry.record({
      projectId: "p",
      releaseId: "r",
      installationId: `d${i}`,
      event: i < 3 ? "failed_launch" : "activation",
    });
  assert.equal(shouldPauseRollout(telemetry.aggregate("r")), true);
  const webhooks = new WebhookService();
  const endpoint = webhooks.create({
    organizationId: "o",
    url: "https://example.test/hook",
    events: ["build.success"],
  });
  const delivery = webhooks.queue(endpoint.id, "build.success", {
    buildId: "b",
  });
  assert.ok(delivery);
  assert.match(delivery.signature, /^v1=/);
  assert.equal(webhooks.recordResult(delivery.id, false).status, "retry");
});
test("operations redact secrets and prune expired records", () => {
  assert.equal(redact("token=secret", ["secret"]), "token=[REDACTED]");
  assert.equal(
    pruneExpired([{ expiresAt: "2000-01-01" }, { expiresAt: "2999-01-01" }], {
      getExpiresAt: (item) => item.expiresAt,
      now: Date.parse("2025-01-01"),
    }).length,
    1,
  );
});
test("SDK accepts newer signed candidates and rolls back after failed launches", () => {
  const keys = createSigningKey();
  const service = new OtaService({ signingKey: keys });
  const embedded = service.publish({
    projectId: "p",
    channel: "production",
    platform: "android",
    runtimeVersion: "fp-1",
    assets: [{ path: "main.js", data: "v1" }],
  });
  const candidate = service.publish({
    projectId: "p",
    channel: "production",
    platform: "android",
    runtimeVersion: "fp-1",
    assets: [{ path: "main.js", data: "v2" }],
  });
  const client = new OtaClient({
    embedded,
    publicKeys: { [keys.keyId]: keys.publicKey },
    maxConsecutiveFailedLaunches: 2,
  });
  assert.equal(client.offer(candidate), true);
  client.activate();
  assert.equal(client.reportLaunchFailure().rolledBack, false);
  assert.equal(client.reportLaunchFailure().rolledBack, true);
  assert.equal(client.snapshot().active, embedded.id);
  assert.equal(
    verifyAsset("v1", embedded.manifest.assets[0]?.hash ?? ""),
    true,
  );
});
test("key rotation and revocation prevent future verification", () => {
  const keyring = new Keyring();
  const key = createSigningKey();
  keyring.add(key);
  const service = new OtaService({ signingKey: key });
  const release = service.publish({
    projectId: "p",
    channel: "preview",
    platform: "android",
    runtimeVersion: "fp-1",
    assets: [{ path: "main.js", data: "x" }],
  });
  assert.equal(keyring.verify(release.manifest, release.signature), true);
  keyring.revoke(key.keyId, "incident");
  assert.equal(keyring.verify(release.manifest, release.signature), false);
});
test("cache keys include reproducibility inputs and device registry is scoped", () => {
  const cache = new BuildCache();
  const key = cache.key({
    sourceHash: "s",
    runtimeFingerprint: "r",
    profile: "production",
    toolchain: "node24",
  });
  cache.put(
    key,
    { hash: "artifact" },
    { sourceHash: "s", toolchain: "node24" },
  );
  assert.equal(cache.get(key)?.artifact.hash, "artifact");
  const devices = new DeviceRegistry();
  const device = devices.register({
    organizationId: "o",
    projectId: "p",
    platform: "ios",
    udid: "ABC",
    name: "test",
  });
  assert.equal(devices.list("p")[0]?.id, device.id);
  devices.remove(device.id);
  assert.equal(devices.list("p").length, 0);
});
test("provider selection stays capability-based and audit records are immutable", () => {
  const providers = new ProviderCatalog();
  providers.register({
    id: "local-android",
    platform: "android",
    capabilities: { signing: true },
    execute: async () => ({ ok: true }),
  });
  assert.equal(
    providers.select({ platform: "android", required: ["signing"] })?.id,
    "local-android",
  );
  const audit = new AuditLog();
  const event = audit.record({
    organizationId: "o",
    event: "build.created",
    resourceType: "build",
    resourceId: "b",
  });
  assert.equal(Object.isFrozen(event), true);
  assert.equal(audit.list("o").length, 1);
});
test("plan limits and rate limits are explicit and bounded", () => {
  const policy = new LimitPolicy("free");
  assert.equal(
    policy.check({ metric: "android_build_minutes", used: 29, requested: 2 })
      .allowed,
    false,
  );
  const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.check("ip", 0).allowed, true);
  assert.equal(limiter.check("ip", 1).allowed, true);
  assert.equal(limiter.check("ip", 2).allowed, false);
  assert.equal(limiter.check("ip", 1001).allowed, true);
});
test("storage policy protects R2 presigned URL semantics and backups verify integrity", () => {
  assert.equal(
    validatePresignedAccess({
      provider: "r2",
      endpoint: "https://account.r2.cloudflarestorage.com",
      customDomain: false,
    }).allowed,
    true,
  );
  assert.equal(
    validatePresignedAccess({
      provider: "r2",
      endpoint: "https://updates.example.com",
      customDomain: true,
    }).allowed,
    false,
  );
  const backup = createBackup(
    { projects: [{ id: "p" }] },
    { createdAt: "2026-01-01T00:00:00.000Z" },
  );
  assert.deepEqual(restoreBackup(backup), { projects: [{ id: "p" }] });
  assert.throws(() => restoreBackup({ ...backup, hash: "bad" }), {
    code: "BACKUP_INVALID",
  });
});
test("source manifests are deterministic and ignore credentials/build outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-source-"));
  await mkdir(join(root, "dist"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "main.js"), "hello");
  await writeFile(join(root, "dist", "ignored.js"), "ignore");
  await writeFile(join(root, ".git", "config"), "ignore");
  const manifest = await createSourceManifest(root);
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    ["main.js"],
  );
  assert.equal(manifest.hash, (await createSourceManifest(root)).hash);
});
test("rollout health guard pauses and selects the previous release", () => {
  const service = new OtaService();
  const first = service.publish({
    projectId: "p",
    channel: "production",
    platform: "android",
    runtimeVersion: "fp-1",
    assets: [{ path: "main.js", data: "v1" }],
  });
  const second = service.publish({
    projectId: "p",
    channel: "production",
    platform: "android",
    runtimeVersion: "fp-1",
    assets: [{ path: "main.js", data: "v2" }],
  });
  const result = service.guardHealth(
    second.id,
    { activations: 20, failures: 3 },
    { minSamples: 20, maxFailureRate: 0.1 },
  );
  assert.equal(result.paused, true);
  assert.equal(result.rolledBackTo, first.id);
  assert.equal(
    service.check({
      projectId: "p",
      channel: "production",
      platform: "android",
      runtimeVersion: "fp-1",
      installationId: "device",
    })?.id,
    first.id,
  );
});
test("migration tracker requires contiguous versions and applies pending work once", () => {
  assert.deepEqual(
    validateMigrationNames(["002_add_projects.sql", "001_initial.sql"]),
    [1, 2],
  );
  assert.throws(
    () => validateMigrationNames(["001_initial.sql", "003_gap.sql"]),
    { code: "MIGRATION_ORDER" },
  );
  const tracker = new MigrationTracker([1]);
  assert.deepEqual(
    tracker
      .pending([{ version: 1 }, { version: 2 }])
      .map((migration) => migration.version),
    [2],
  );
  assert.deepEqual(tracker.apply({ version: 2 }), [1, 2]);
});
