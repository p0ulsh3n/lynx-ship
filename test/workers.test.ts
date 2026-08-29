import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildJob } from "@lynxship/contracts";
import {
  AndroidWorkerError,
  executeAndroidBuild,
  inspectAndroidWorkerEnvironment,
} from "@lynxship/worker-android";
import {
  executeIosBuild,
  IosWorkerError,
  inspectIosWorkerEnvironment,
} from "@lynxship/worker-ios";

function job(platform: "android" | "ios"): BuildJob {
  return {
    id: `${platform}-job`,
    projectId: "project",
    organizationId: "organization",
    platform,
    profile: "release",
    sourceHash: null,
    state: "queued",
    attempts: 0,
    logs: [],
    transitions: [],
  };
}

test("Android worker executes an allow-listed task and hashes its output", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-worker-android-"));
  const project = join(root, "project");
  await mkdir(join(project, "outputs"), { recursive: true });
  const artifact = join(project, "outputs", "app-debug.apk");
  let command = "";
  const result = await executeAndroidBuild(
    {
      job: job("android"),
      projectRoot: project,
      task: "assembleDebug",
      artifactPath: "outputs/app-debug.apk",
    },
    {
      workspaceRoot: root,
      environmentReady: async () => true,
      runner: async (executable, args, cwd) => {
        command = [executable, ...args].join(" ");
        assert.equal(cwd, project);
        await writeFile(artifact, "apk");
        return { code: 0, stdout: "ok", stderr: "" };
      },
    },
  );
  assert.match(command, /assembleDebug/);
  assert.equal(result.artifact?.name, "app-debug.apk");
  assert.equal(result.artifact?.hash.length, 64);
});

test("Android worker rejects shell injection and missing preflight", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-worker-android-"));
  await assert.rejects(
    executeAndroidBuild(
      {
        job: job("android"),
        projectRoot: root,
        task: "assembleDebug",
        artifactPath: "out.apk",
        args: [";rm -rf /"],
      },
      {
        workspaceRoot: root,
        environmentReady: async () => true,
        runner: async () => ({ code: 0, stdout: "", stderr: "" }),
      },
    ),
    (error: unknown) =>
      error instanceof AndroidWorkerError &&
      error.code === "ANDROID_REQUEST_INVALID",
  );
  const environment = await inspectAndroidWorkerEnvironment(
    root,
    async () => false,
  );
  assert.equal(environment.ready, false);
});

test("iOS worker passes validated xcodebuild arguments and hashes its output", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-worker-ios-"));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  const artifact = join(project, "build", "Test.app");
  await mkdir(artifact, { recursive: true });
  let args: readonly string[] = [];
  const result = await executeIosBuild(
    {
      job: job("ios"),
      projectRoot: project,
      projectFile: "Test.xcodeproj",
      scheme: "Test App",
      configuration: "Release",
      sdk: "iphonesimulator",
      artifactPath: "build/Test.app",
      args: ["CODE_SIGNING_ALLOWED=NO"],
    },
    {
      workspaceRoot: root,
      environmentReady: async () => true,
      runner: async (executable, receivedArgs, cwd) => {
        assert.equal(executable, "xcodebuild");
        assert.equal(cwd, project);
        args = receivedArgs;
        return { code: 0, stdout: "ok", stderr: "" };
      },
    },
  );
  assert.ok(args.includes("-scheme"));
  assert.ok(args.includes("Test App"));
  assert.equal(result.artifact?.name, "Test.app");
  assert.equal(result.artifact?.hash.length, 64);
});

test("iOS worker rejects non-macOS-safe request values", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-worker-ios-"));
  await assert.rejects(
    executeIosBuild(
      {
        job: job("ios"),
        projectRoot: root,
        projectFile: "Test.xcodeproj",
        scheme: "Test;rm -rf /",
        configuration: "Release",
        sdk: "iphoneos",
        artifactPath: "build/Test.ipa",
      },
      {
        workspaceRoot: root,
        environmentReady: async () => true,
        runner: async () => ({ code: 0, stdout: "", stderr: "" }),
      },
    ),
    (error: unknown) =>
      error instanceof IosWorkerError && error.code === "IOS_REQUEST_INVALID",
  );
  const environment = await inspectIosWorkerEnvironment(async () => false);
  assert.equal(environment.ready, false);
});
