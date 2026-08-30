import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  hasDesktopHost,
  resolveDesktopPackScript,
} from "../packages/cli/src/desktop-build.js";
import { inspectDesktopSigning } from "../packages/cli/src/desktop-signing.js";
import { guidanceForError } from "../packages/cli/src/guidance.js";
import { detectWebBuildScript } from "../packages/cli/src/web-build.js";
import {
  prepareIosAppIcon,
  syncIosRuntimeResources,
} from "../packages/cli/src/ios-build.js";
import { syncHarmonyAssets } from "../packages/cli/src/harmony-build.js";
import {
  projectDirectoryFlag,
  readFlag,
} from "../packages/cli/src/runtime/args.js";
import {
  exists,
  findLockfile,
  findProjectRoot,
} from "../packages/cli/src/runtime/project.js";
import { inspectEcosystem } from "../packages/cli/src/ecosystem.js";
import { packageManagerInstallCommand } from "../packages/cli/src/process-runner.js";
import {
  createI18nSetupPlan,
  entryImportPath,
  renderPolyfillSource,
} from "../packages/cli/src/i18n/plan.js";
import {
  cancelRemoteBuild,
  createRemoteBuild,
  listRemoteBuilds,
  retryRemoteBuild,
  uploadBuildSource,
  waitForRemoteBuild,
} from "../packages/cli/src/remote.js";
import { prepareRemoteSource } from "../packages/cli/src/commands/remote-build.js";
import { createApi } from "../packages/api/src/http-api.js";
import {
  encodeSourceSnapshot,
  SOURCE_SNAPSHOT_CONTENT_TYPE,
} from "../packages/build-orchestrator/src/source-snapshot.js";
import { hashJson, sha256 } from "../packages/contracts/src/index.js";

test("ecosystem inspection is read-only and reports first-party packages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-ecosystem-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ dependencies: { "@lynxship/i18n": "0.1.0" } }),
  );
  const packages = await inspectEcosystem(cwd);
  assert.equal(
    packages.find((item) => item.name === "@lynxship/i18n")?.installed,
    true,
  );
  assert.equal(
    packages.find((item) => item.name === "@lynxship/media")?.installed,
    false,
  );
  assert.equal(
    packages.find((item) => item.name === "@lynxship/framework")?.installed,
    false,
  );
  assert.equal(
    packages.find((item) => item.name === "@lynxship/performance")?.installed,
    false,
  );
});

test("i18n setup plans compatible polyfills, dependencies and entry wiring", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-i18n-setup-"));
  await mkdir(join(cwd, "src", "locales"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "i18n-setup",
      dependencies: { "@lynxship/i18n": "0.1.0" },
    }),
  );
  await writeFile(
    join(cwd, "src", "index.tsx"),
    "import { App } from './App';\n",
  );
  await writeFile(join(cwd, "src", "locales", "en.json"), "{}\n");
  await writeFile(join(cwd, "src", "locales", "fr.json"), "{}\n");

  const plan = await createI18nSetupPlan({
    root: cwd,
    persistence: true,
  });
  assert.equal(plan.entryFile, "src/index.tsx");
  assert.deepEqual(plan.locales, ["en", "fr"]);
  assert.deepEqual(plan.capabilities, [
    "getCanonicalLocales",
    "Locale",
    "PluralRules",
  ]);
  assert.ok(plan.packages.includes("i18next@^26.0.0"));
  assert.ok(plan.packages.includes("@lynxship/device-storage"));
  assert.ok(
    renderPolyfillSource(plan).includes(
      "@formatjs/intl-getcanonicallocales/polyfill-force.js",
    ),
  );
  assert.equal(entryImportPath(plan), "./lynxship/i18n-polyfills.js");
});

test("i18n dependency installation remains exact and follows the project manager", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-package-manager-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ packageManager: "pnpm@11.19.0" }),
  );
  assert.deepEqual(packageManagerInstallCommand(cwd, ["i18next@^26.0.0"]), {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: ["add", "--save-exact", "i18next@^26.0.0"],
  });
});

test("CLI runtime helpers resolve flags and project boundaries deterministically", async () => {
  assert.equal(
    projectDirectoryFlag(["doctor", "--project-dir", "./example"]),
    "./example",
  );
  assert.equal(
    projectDirectoryFlag(["doctor", "--project-dir=./inline"]),
    "./inline",
  );
  assert.equal(
    readFlag(["build", "--profile", "simulator"], "--profile"),
    "simulator",
  );
  assert.equal(readFlag(["build"], "--profile", "production"), "production");
  const isolated = await mkdtemp(join(tmpdir(), "lynxship-runtime-"));
  assert.equal(await exists(isolated), true);
  assert.equal(findProjectRoot(isolated), isolated);
  assert.equal(await findLockfile(isolated), null);
});

test("remote build flow uploads one verified source and polls the same job", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-remote-build-"));
  await writeFile(join(cwd, "package.json"), '{"name":"remote-fixture"}\n');
  await writeFile(join(cwd, "lynxship.json"), '{"projectId":"project-name"}\n');
  const state = {};
  const config = {
    projectId: "project-name",
    cli: { apiUrl: "https://lynxship.test", token: "token" },
  };
  const sourceHash = "a".repeat(64);
  const source = {
    key: `sources/${sourceHash}`,
    hash: sourceHash,
    size: 42,
    contentType: "application/vnd.lynxship.source-snapshot+json",
    fileCount: 2,
  };
  const job = {
    id: "build-remote-test",
    projectId: "project-id",
    organizationId: "organization-id",
    platform: "android",
    profile: "production",
    idempotencyKey: "remote-key",
    sourceHash,
    source,
    state: "created",
    attempts: 0,
    logs: [],
    transitions: [{ state: "created", at: new Date().toISOString() }],
  };
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : undefined,
    });
    const path = new URL(url).pathname;
    if (path === "/v1/organizations" && init.method === "POST")
      return new Response(JSON.stringify({ id: "organization-id" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    if (path === "/v1/projects" && (init.method ?? "GET") === "GET")
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (path === "/v1/projects" && init.method === "POST")
      return new Response(JSON.stringify({ id: "project-id" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    if (path === "/v1/build-sources" && init.method === "POST")
      return new Response(JSON.stringify({ source }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    if (path === "/v1/builds" && init.method === "POST")
      return new Response(JSON.stringify(job), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    if (path === `/v1/builds/${job.id}`) {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          ...job,
          state: fetchCount > 0 ? "success" : "created",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ message: `unexpected ${path}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const uploaded = await uploadBuildSource(
      config,
      state,
      Buffer.from("snapshot"),
    );
    assert.deepEqual(uploaded, source);
    const created = await createRemoteBuild(config, state, {
      platform: "android",
      profile: "production",
      source,
    });
    assert.equal(created.id, job.id);
    const finished = await waitForRemoteBuild(config, job.id, {
      timeoutMs: 100,
      pollMs: 0,
    });
    assert.equal(finished.state, "success");
    assert.equal(
      JSON.parse(
        requests.find((request) => request.url.endsWith("/v1/build-sources"))!
          .body!,
      ).dataBase64,
      Buffer.from("snapshot").toString("base64"),
    );
    assert.ok(
      requests.every((request) =>
        request.url.startsWith("https://lynxship.test"),
      ),
    );
    const prepared = await prepareRemoteSource(cwd, config, state);
    assert.deepEqual(prepared, source);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote source upload uses the verified direct object-storage path", async () => {
  const config = {
    projectId: "remote-project",
    cli: { apiUrl: "https://lynxship.test", token: "token" },
  };
  const state = {
    remoteOrganizationId: "organization-id",
    remoteProjectId: "project-id",
  };
  const bytes = encodeSourceSnapshot({
    schemaVersion: 1,
    manifestHash: hashJson([]),
    files: [],
  });
  const hash = sha256(bytes);
  const source = {
    key: `sources/${hash}`,
    hash,
    size: bytes.length,
    contentType: SOURCE_SNAPSHOT_CONTENT_TYPE,
    fileCount: 0,
  };
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body });
    const pathname = new URL(url).pathname;
    if (pathname === "/v1/build-sources/upload-plan")
      return new Response(
        JSON.stringify({
          source,
          upload: {
            method: "PUT",
            url: "https://objects.lynxship.test/signed-source",
            headers: { "content-type": SOURCE_SNAPSHOT_CONTENT_TYPE },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    if (url === "https://objects.lynxship.test/signed-source")
      return new Response(null, { status: 200 });
    if (pathname === "/v1/build-sources/complete")
      return new Response(JSON.stringify({ source }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return new Response(JSON.stringify({ error: "unexpected" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const uploaded = await uploadBuildSource(config, state, bytes);
    assert.deepEqual(uploaded, source);
    assert.deepEqual(
      calls.map(({ url, method }) => ({ url, method })),
      [
        {
          url: "https://lynxship.test/v1/build-sources/upload-plan",
          method: "POST",
        },
        {
          url: "https://objects.lynxship.test/signed-source",
          method: "PUT",
        },
        {
          url: "https://lynxship.test/v1/build-sources/complete",
          method: "POST",
        },
      ],
    );
    const put = calls[1]!;
    assert.ok(put.body instanceof Uint8Array);
    assert.deepEqual(Buffer.from(put.body as Uint8Array), bytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote build controls use the hosted API and preserve tenant scoping", async () => {
  const config = {
    projectId: "remote-project",
    cli: { apiUrl: "https://lynxship.test", token: "token" },
  };
  const state = {
    remoteOrganizationId: "organization-id",
    remoteProjectId: "project-id",
  };
  const job = {
    id: "build-remote-control",
    projectId: "project-id",
    organizationId: "organization-id",
    platform: "android",
    profile: "production",
    idempotencyKey: "remote-control-key",
    sourceHash: null,
    state: "queued",
    attempts: 0,
    logs: [],
    transitions: [],
  } as const;
  const requests: Array<{ url: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, method: init.method ?? "GET" });
    const pathname = new URL(url).pathname;
    if (pathname === "/v1/builds" && (init.method ?? "GET") === "GET")
      return new Response(JSON.stringify([job]), { status: 200 });
    if (pathname.endsWith("/cancel"))
      return new Response(JSON.stringify({ ...job, state: "canceled" }), {
        status: 200,
      });
    if (pathname.endsWith("/retry"))
      return new Response(JSON.stringify({ ...job, state: "queued" }), {
        status: 200,
      });
    return new Response(JSON.stringify({ message: `unexpected ${pathname}` }), {
      status: 404,
    });
  };
  try {
    assert.deepEqual(await listRemoteBuilds(config, state), [job]);
    assert.equal((await cancelRemoteBuild(config, job.id)).state, "canceled");
    assert.equal((await retryRemoteBuild(config, job.id)).state, "queued");
    assert.deepEqual(
      requests.map((request) => request.method),
      ["GET", "POST", "POST"],
    );
    assert.match(requests[0]!.url, /organizationId=organization-id/);
    assert.match(requests[0]!.url, /projectId=project-id/);
    assert.match(requests[1]!.url, /build-remote-control\/cancel$/);
    assert.match(requests[2]!.url, /build-remote-control\/retry$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CLI remote build creates a source-backed job without local signing or R2", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-remote-cli-"));
  await writeFile(
    join(cwd, "package.json"),
    '{"name":"remote-cli-fixture","scripts":{"build":"true"}}\n',
  );
  await writeFile(
    join(cwd, "lynxship.json"),
    '{"projectId":"remote-cli-project"}\n',
  );
  const server = createApi({ artifactRoot: join(cwd, "objects") });
  await server.listen({ host: "127.0.0.1", port: 0 });
  t.after(async () => {
    await server.close();
    await rm(cwd, { recursive: true, force: true });
  });
  const address = server.server.address();
  assert.ok(address && typeof address !== "string");
  const result = await runCli(
    cwd,
    [
      "build",
      "--platform",
      "web",
      "--profile",
      "production",
      "--remote",
      "--no-wait",
      "--json",
    ],
    { ...process.env, LYNXSHIP_API_URL: `http://127.0.0.1:${address.port}` },
  );
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout) as {
    state: string;
    source?: { hash: string; fileCount: number };
  };
  assert.equal(output.state, "created");
  assert.match(output.source?.hash ?? "", /^[a-f0-9]{64}$/);
  assert.ok((output.source?.fileCount ?? 0) >= 2);
});

function runCli(
  cwd: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "packages", "cli", "dist", "index.js"), ...args],
      { cwd, env: environment },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("iOS packaging carries Rspeedy assets and a project app icon into the host", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-ios-assets-"));
  const appBundle = join(cwd, "build", "Test.app");
  const iconSet = join(
    cwd,
    "ios",
    "Test",
    "Assets.xcassets",
    "AppIcon.appiconset",
  );
  await mkdir(join(cwd, "dist", "static", "image"), { recursive: true });
  await mkdir(join(cwd, "dist", "async"), { recursive: true });
  await mkdir(iconSet, { recursive: true });
  await mkdir(appBundle, { recursive: true });
  await writeFile(join(cwd, "dist", "main.lynx.bundle"), "bundle");
  await writeFile(join(cwd, "dist", "static", "image", "logo.png"), "logo");
  await writeFile(join(cwd, "dist", "async", "chunk.js"), "chunk");
  await writeFile(
    join(cwd, "ios", "Test", "Assets.xcassets", "Contents.json"),
    "{}\n",
  );
  await writeFile(
    join(iconSet, "Contents.json"),
    '{"images":[],"info":{"version":1}}\n',
  );

  const png = Buffer.alloc(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.writeUInt32BE(1024, 16);
  png.writeUInt32BE(1024, 20);
  await writeFile(join(cwd, "icon.png"), png.toString("binary"), "binary");

  assert.deepEqual(await syncIosRuntimeResources(cwd, appBundle), [
    "main.lynx.bundle",
    "async",
    "static",
  ]);
  assert.equal(
    await readFile(join(appBundle, "static", "image", "logo.png"), "utf8"),
    "logo",
  );
  assert.equal(
    await readFile(join(appBundle, "async", "chunk.js"), "utf8"),
    "chunk",
  );
  assert.equal(await prepareIosAppIcon(cwd), join(cwd, "icon.png"));
  assert.match(
    await readFile(join(iconSet, "Contents.json"), "utf8"),
    /AppIcon\.png/,
  );
});

test("HarmonyOS packaging carries Rspeedy static and async assets", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-harmony-assets-"));
  await mkdir(join(cwd, "dist", "static"), { recursive: true });
  await mkdir(join(cwd, "dist", "async"), { recursive: true });
  await writeFile(join(cwd, "dist", "main.lynx.bundle"), "bundle");
  await writeFile(join(cwd, "dist", "static", "logo.png"), "logo");
  await writeFile(join(cwd, "dist", "async", "chunk.js"), "chunk");

  const copied = await syncHarmonyAssets(cwd, {
    harmony: { bundleDir: "harmony/entry/src/main/resources/rawfile" },
  });
  assert.deepEqual(copied, ["main.lynx.bundle", "async", "static"]);
  assert.equal(
    await readFile(
      join(
        cwd,
        "harmony",
        "entry",
        "src",
        "main",
        "resources",
        "rawfile",
        "static",
        "logo.png",
      ),
      "utf8",
    ),
    "logo",
  );
});

test("TypeScript CLI init/build/update use persistent local state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-"));
  const keystore = join(cwd, "test-signing.jks");
  await writeFile(keystore, "test keystore placeholder");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
    R2_BUCKET: "test",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    LYNXSHIP_KEYSTORE_PATH: keystore,
    LYNXSHIP_KEY_ALIAS: "test",
    LYNXSHIP_KEYSTORE_PASSWORD: "test-password",
    LYNXSHIP_KEY_PASSWORD: "test-password",
    LYNXSHIP_SUBMIT_MODE: "mock",
  };
  const init = await runCli(cwd, ["init", "--non-interactive", "--json"]);
  assert.equal(init.code, 0);
  const projectConfig = JSON.parse(
    await readFile(join(cwd, "lynxship.json"), "utf8"),
  ) as { projectId: string };
  assert.match(projectConfig.projectId, /^[0-9a-f-]{36}$/);
  const realBuild = await runCli(
    cwd,
    ["build", "--platform", "android", "--json"],
    environment,
  );
  assert.equal(realBuild.code, 1);
  const realBuildError = JSON.parse(realBuild.stdout) as {
    code: string;
    nextSteps: string[];
  };
  assert.equal(realBuildError.code, "ANDROID_HOST_REQUIRED");
  assert.deepEqual(realBuildError.nextSteps, [
    "lynxship dev",
    "lynxship android host init --application-id com.example.myapp",
    "lynxship build --platform android --application-id com.example.myapp --profile production",
    "lynxship doctor --platform android",
  ]);
  const build = await runCli(
    cwd,
    ["build", "--platform", "android", "--local", "--json"],
    environment,
  );
  assert.equal(build.code, 0);
  assert.equal(JSON.parse(build.stdout).state, "success");
  const submit = await runCli(
    cwd,
    ["submit", "--platform", "android", "--latest", "--json"],
    environment,
  );
  assert.equal(submit.code, 0);
  assert.equal(JSON.parse(submit.stdout).status, "submitted");
  const update = await runCli(
    cwd,
    ["update", "--platform", "android", "--json"],
    environment,
  );
  assert.equal(update.code, 0);
  assert.equal(JSON.parse(update.stdout).manifest.platform, "android");
  const releaseId = JSON.parse(update.stdout).id as string;
  const rollback = await runCli(
    cwd,
    [
      "update",
      "rollback",
      "--platform",
      "android",
      "--release-id",
      releaseId,
      "--reason",
      "Verify local rollback",
      "--local",
      "--json",
    ],
    environment,
  );
  assert.equal(rollback.code, 0);
  assert.equal(JSON.parse(rollback.stdout).status, "rolled_back");
  assert.equal(JSON.parse(rollback.stdout).release.id, releaseId);
  assert.match(
    await readFile(join(cwd, ".lynxship", "state.json"), "utf8"),
    /releases/,
  );
  const selfHost = await runCli(cwd, ["self-host", "init", "--json"]);
  assert.equal(selfHost.code, 0);
  assert.match(
    await readFile(join(cwd, ".lynxship", ".env"), "utf8"),
    /POSTGRES_PASSWORD=/,
  );
});

test("auto-initializes a Vue Lynx project from its vue-lynx dependency", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-vue-lynx-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "vue-lynx-app",
      dependencies: { "vue-lynx": "0.5.1" },
    }),
  );
  await writeFile(join(cwd, "package-lock.json"), "{}\n");

  const result = await runCli(cwd, [
    "build",
    "--platform",
    "android",
    "--local",
    "--json",
  ]);

  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).state, "success");
  const config = JSON.parse(
    await readFile(join(cwd, "lynxship.json"), "utf8"),
  ) as { projectId: string };
  assert.match(config.projectId, /^[0-9a-f-]{36}$/);
});

test("build all creates one contract job for every supported Lynx target", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-build-all-"));
  const keystore = join(cwd, "test-signing.jks");
  await writeFile(keystore, "test keystore placeholder");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
    R2_BUCKET: "test",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    LYNXSHIP_KEYSTORE_PATH: keystore,
    LYNXSHIP_KEY_ALIAS: "test",
    LYNXSHIP_KEYSTORE_PASSWORD: "test-password",
    LYNXSHIP_KEY_PASSWORD: "test-password",
  };
  const init = await runCli(cwd, ["init", "--non-interactive", "--json"]);
  assert.equal(init.code, 0);
  const result = await runCli(
    cwd,
    ["build", "all", "--local", "--json"],
    environment,
  );
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as {
    status: string;
    builds: Array<{ platform: string; state: string }>;
  };
  assert.equal(parsed.status, "success");
  assert.deepEqual(
    parsed.builds.map((build) => [build.platform, build.state]),
    [
      ["android", "success"],
      ["ios", "success"],
      ["harmony", "success"],
      ["web", "success"],
      ["desktop", "success"],
    ],
  );
});

test("target diagnostics and real-build guards cover Web, HarmonyOS and Desktop", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-targets-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      scripts: { build: "rspeedy build" },
      dependencies: { "@lynx-js/rspeedy": "4.0.0" },
    }),
  );
  await writeFile(join(cwd, "package-lock.json"), "{}\n");
  await writeFile(
    join(cwd, "lynx.config.ts"),
    "export default { environments: { web: {} } };\n",
  );
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
    R2_BUCKET: "test",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    LYNXSHIP_KEYSTORE_PATH: join(cwd, "missing.jks"),
    LYNXSHIP_KEY_ALIAS: "test",
    LYNXSHIP_KEYSTORE_PASSWORD: "test-password",
    LYNXSHIP_KEY_PASSWORD: "test-password",
  };
  const init = await runCli(cwd, ["init", "--non-interactive", "--json"]);
  assert.equal(init.code, 0);

  const webDoctor = await runCli(
    cwd,
    ["doctor", "--platform", "web", "--json"],
    environment,
  );
  assert.equal(webDoctor.code, 0);
  assert.match(webDoctor.stdout, /web-configuration/);
  assert.match(webDoctor.stdout, /web-build-tool/);

  for (const platform of ["harmony", "desktop"]) {
    const result = await runCli(
      cwd,
      ["build", "--platform", platform, "--json"],
      environment,
    );
    assert.equal(result.code, 1);
    const error = JSON.parse(result.stdout) as { code: string };
    assert.equal(
      error.code,
      platform === "harmony"
        ? "HARMONY_HOST_REQUIRED"
        : "DESKTOP_HOST_REQUIRED",
    );
  }
});

test("recognizes current Lynx Web and Electron desktop script conventions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-platform-scripts-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      scripts: {
        "build:web": "rspeedy build -c ./config/lynx.web.ts",
        "build:app": "electron-builder",
      },
      devDependencies: { "electron-builder": "26.0.12" },
    }),
  );
  const manifest = JSON.parse(
    await readFile(join(cwd, "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(detectWebBuildScript(cwd), "build:web");
  assert.equal(resolveDesktopPackScript(manifest), "build:app");
  assert.equal(await hasDesktopHost(cwd), true);

  const signing = await inspectDesktopSigning(cwd);
  assert.ok(["missing", "unknown", "not-required"].includes(signing.status));
});

test("does not allow unsigned Desktop artifacts to be uploaded", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-desktop-signing-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      scripts: { pack: "node -e \\\"console.log('pack')\\\"" },
      devDependencies: { "electron-builder": "26.0.12" },
    }),
  );
  const init = await runCli(cwd, ["init", "--non-interactive", "--json"]);
  assert.equal(init.code, 0);
  const result = await runCli(cwd, [
    "build",
    "--platform",
    "desktop",
    "--allow-unsigned",
    "--json",
  ]);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).code, "CLI_UNSIGNED_UPLOAD_BLOCKED");
});

test("android host init scaffolds a native host without overwriting projects", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-android-host-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ dependencies: { "@lynx-js/rspeedy": "4.0.0" } }),
  );
  const result = await runCli(cwd, [
    "android",
    "host",
    "init",
    "--application-id",
    "com.example.demo",
    "--non-interactive",
    "--json",
  ]);

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "created",
    platform: "android",
    directory: join(cwd, "android"),
    applicationId: "com.example.demo",
  });
  const mainActivity = await readFile(
    join(
      cwd,
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "example",
      "demo",
      "MainActivity.java",
    ),
    "utf8",
  );
  assert.match(mainActivity, /package com\.example\.demo;/);
  assert.match(mainActivity, /onPageStart\(String url\)/);
  assert.match(mainActivity, /onFirstScreen\(\)/);
  assert.match(mainActivity, /onReceivedError\(LynxError error\)/);
  assert.match(mainActivity, /removeLynxViewClient\(lifecycleClient\)/);
  assert.match(mainActivity, /lynxView\.destroy\(\)/);

  const second = await runCli(cwd, [
    "android",
    "host",
    "init",
    "--application-id",
    "com.example.other",
    "--non-interactive",
    "--json",
  ]);
  assert.equal(second.code, 1);
  assert.equal(JSON.parse(second.stdout).code, "ANDROID_HOST_EXISTS");
});

test("real Android build bootstraps a missing host before bundle execution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-build-host-bootstrap-"));
  const keystore = join(cwd, "test-signing.jks");
  await writeFile(keystore, "test keystore placeholder");
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "host-bootstrap",
      scripts: { build: "rspeedy build" },
      devDependencies: { "@lynx-js/rspeedy": "0.16.5" },
    }),
  );
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ANDROID_SDK_ROOT: join(cwd, "missing-android-sdk"),
    LYNXSHIP_KEYSTORE_PATH: keystore,
    LYNXSHIP_KEY_ALIAS: "test",
    LYNXSHIP_KEYSTORE_PASSWORD: "test-password",
    LYNXSHIP_KEY_PASSWORD: "test-password",
  };
  const result = await runCli(
    cwd,
    [
      "build",
      "--platform",
      "android",
      "--application-id",
      "com.example.bootstrap",
      "--no-upload",
      "--non-interactive",
      "--json",
    ],
    environment,
  );
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).code, "CLI_ERROR");
  assert.match(result.stdout, /rspeedy/);
  assert.match(
    await readFile(join(cwd, "android", "app", "build.gradle"), "utf8"),
    /com\.example\.bootstrap/,
  );
});

test("ios host init scaffolds an Xcode host without overwriting projects", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-ios-host-"));
  const init = await runCli(cwd, ["init", "--non-interactive", "--json"]);
  assert.equal(init.code, 0);
  const result = await runCli(cwd, [
    "ios",
    "host",
    "init",
    "--bundle-identifier",
    "com.example.demo",
    "--non-interactive",
    "--json",
  ]);

  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as {
    status: string;
    platform: string;
    bundleIdentifier: string;
    project: string;
    scheme: string;
    configUpdated: boolean;
  };
  assert.equal(parsed.status, "created");
  assert.equal(parsed.platform, "ios");
  assert.equal(parsed.bundleIdentifier, "com.example.demo");
  assert.equal(parsed.project, `ios/${parsed.scheme}.xcodeproj`);
  assert.match(parsed.scheme, /^LynxshipIosHost/);
  assert.equal(parsed.configUpdated, true);
  assert.match(
    await readFile(
      join(cwd, "ios", `${parsed.scheme}.xcodeproj`, "project.pbxproj"),
      "utf8",
    ),
    /PRODUCT_BUNDLE_IDENTIFIER = "com\.example\.demo";/,
  );
  assert.match(
    await readFile(join(cwd, "lynxship.json"), "utf8"),
    new RegExp(`"project": "${parsed.project}"`),
  );
  const iosViewController = await readFile(
    join(cwd, "ios", parsed.scheme, "ViewController.swift"),
    "utf8",
  );
  assert.match(iosViewController, /lynxViewDidStartLoading/);
  assert.match(iosViewController, /lynxViewDidFirstScreen/);
  assert.match(iosViewController, /Tap to retry/);
  const iosProvider = await readFile(
    join(cwd, "ios", parsed.scheme, "DemoLynxProvider.swift"),
    "utf8",
  );
  assert.match(iosProvider, /onError/);

  const second = await runCli(cwd, [
    "ios",
    "host",
    "init",
    "--bundle-identifier",
    "com.example.other",
    "--non-interactive",
    "--json",
  ]);
  assert.equal(second.code, 1);
  assert.equal(JSON.parse(second.stdout).code, "IOS_HOST_EXISTS");
});

test("CLI blocks operational commands before R2 and signing setup", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-guard-"));
  const isolatedAppData = await mkdtemp(join(tmpdir(), "lynxship-config-"));
  const environment = {
    ...process.env,
    APPDATA: isolatedAppData,
    LYNXSHIP_CONFIG_DIR: join(isolatedAppData, "LynxShip"),
  };
  const init = await runCli(
    cwd,
    ["init", "--non-interactive", "--json"],
    environment,
  );
  assert.equal(init.code, 0);
  const build = await runCli(
    cwd,
    ["build", "--platform", "android", "--local", "--json"],
    environment,
  );
  assert.equal(build.code, 2);
  assert.equal(JSON.parse(build.stdout).code, "CLI_R2_REQUIRED");
});

test("CLI blocks real OTA after a native project change", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-ota-guard-"));
  const keystore = join(cwd, "test-signing.jks");
  await writeFile(keystore, "test keystore placeholder");
  await mkdir(join(cwd, "android", "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "ota-guard",
      devDependencies: { "@lynx-js/react": "^0.12.0" },
    }),
  );
  await writeFile(join(cwd, "android", "app", "build.gradle"), "android {}\n");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
    R2_BUCKET: "test",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    LYNXSHIP_KEYSTORE_PATH: keystore,
    LYNXSHIP_KEY_ALIAS: "test",
    LYNXSHIP_KEYSTORE_PASSWORD: "test-password",
    LYNXSHIP_KEY_PASSWORD: "test-password",
  };
  delete environment.LYNXSHIP_SUBMIT_MODE;
  assert.equal(
    (await runCli(cwd, ["init", "--non-interactive", "--json"])).code,
    0,
  );
  const build = await runCli(
    cwd,
    ["build", "--platform", "android", "--local", "--json"],
    environment,
  );
  assert.equal(build.code, 0);
  await mkdir(join(cwd, "dist"), { recursive: true });
  await writeFile(join(cwd, "dist", "main.lynx.bundle"), "bundle-v1");
  await writeFile(
    join(cwd, "android", "app", "build.gradle"),
    "android { namespace 'changed' }\n",
  );
  const update = await runCli(
    cwd,
    ["update", "--platform", "android", "--json"],
    environment,
  );
  assert.equal(update.code, 7);
  assert.equal(JSON.parse(update.stdout).code, "OTA_NATIVE_CHANGE_REQUIRED");
});

test("CLI never fabricates an iOS build on a non-macOS host", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-ios-guard-"));
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
    R2_BUCKET: "test",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
  };
  assert.equal(
    (await runCli(cwd, ["init", "--non-interactive", "--json"])).code,
    0,
  );
  const result = await runCli(
    cwd,
    ["build", "--platform", "ios", "--json"],
    environment,
  );
  if (process.platform === "darwin") {
    assert.notEqual(result.code, 0);
  } else {
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).code, "IOS_MACOS_REQUIRED");
  }
});

test("DevTool doctor reports the development runtime contract", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-devtool-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "devtool-doctor",
      scripts: { dev: "rspeedy dev" },
      devDependencies: { "@lynx-js/rspeedy": "0.16.5" },
    }),
  );
  const result = await runCli(cwd, ["trace", "doctor", "--json"]);
  assert.equal(result.code, 1);
  const parsed = JSON.parse(result.stdout) as {
    requested: string;
    ready: boolean;
    checks: Array<{ name: string; status: string }>;
  };
  assert.equal(parsed.requested, "trace");
  assert.equal(parsed.ready, false);
  assert.equal(
    parsed.checks.find((check) => check.name === "android-trace-runtime")
      ?.status,
    "fail",
  );
});

test("iOS doctor reports the macOS prerequisite before an iOS build", async () => {
  if (process.platform === "darwin") return;
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-ios-doctor-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "ios-doctor" }),
  );
  await writeFile(join(cwd, "package-lock.json"), "{}\n");
  const result = await runCli(cwd, ["doctor", "--platform", "ios", "--json"]);
  assert.equal(result.code, 1);
  const parsed = JSON.parse(result.stdout) as {
    checks: Array<{ name: string; status: string; value: string }>;
  };
  const platformCheck = parsed.checks.find(
    (check) => check.name === "ios-platform",
  );
  assert.equal(platformCheck?.status, "fail");
  assert.match(platformCheck?.value ?? "", /macOS/);
});

test("iOS Simulator local builds use the simulator profile without R2", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lynxship-ios-simulator-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "ios-simulator" }),
  );
  await writeFile(join(cwd, "package-lock.json"), "{}\n");
  const init = await runCli(cwd, ["init", "--non-interactive", "--json"]);
  assert.equal(init.code, 0);
  const build = await runCli(cwd, [
    "build",
    "--platform",
    "ios",
    "--simulator",
    "--local",
    "--json",
  ]);
  assert.equal(build.code, 0);
  const result = JSON.parse(build.stdout) as {
    state: string;
    profile: string;
  };
  assert.equal(result.state, "success");
  assert.equal(result.profile, "simulator");
});

test("guidance preserves the requested iOS Simulator platform", () => {
  const guidance = guidanceForError(
    { code: "PROFILE_NOT_FOUND", message: "profile missing" },
    {
      args: [
        "build",
        "--platform",
        "ios",
        "--simulator",
        "--profile",
        "development",
      ],
      hostPlatform: "win32",
    },
  );
  assert.deepEqual(guidance.commands, [
    "lynxship doctor --platform ios --profile simulator",
    "lynxship build --platform ios --simulator --profile simulator --no-upload",
  ]);
  assert.ok(!guidance.commands.some((command) => command.includes("android")));
  assert.match(guidance.note ?? "", /macOS/);
  assert.equal(guidance.environment, "macOS or a macOS CI runner");
});

test("guidance keeps Android commands valid on macOS", () => {
  const guidance = guidanceForError(
    { code: "ANDROID_TOOLCHAIN_REQUIRED", message: "toolchain missing" },
    { args: ["build", "--platform", "android"], hostPlatform: "darwin" },
  );
  assert.equal(guidance.commands[0], "lynxship doctor --platform android");
  assert.ok(
    guidance.commands.includes(
      "lynxship build --platform android --profile production",
    ),
  );
  assert.equal(guidance.environment, undefined);
});
