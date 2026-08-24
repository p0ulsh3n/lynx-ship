import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

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
  assert.equal(JSON.parse(realBuild.stdout).code, "ANDROID_HOST_REQUIRED");
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
  assert.match(
    await readFile(
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
    ),
    /package com\.example\.demo;/,
  );

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
    assert.equal(JSON.parse(result.stdout).code, "IOS_HOST_REQUIRED");
  }
});
