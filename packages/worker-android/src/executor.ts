import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve, sep, basename } from "node:path";
import { sha256, type BuildResult } from "@lynxship/contracts";
import {
  AndroidWorkerError,
  type AndroidBuildRequest,
  type WorkerCommandRunner,
} from "./contracts.js";
import { inspectAndroidWorkerEnvironment } from "./environment.js";

function inside(root: string, candidate: string): boolean {
  const resolvedCandidate = isAbsolute(candidate)
    ? candidate
    : resolve(root, candidate);
  const value = relative(resolve(root), resolve(resolvedCandidate));
  return value === "" || (!value.startsWith(".." + sep) && !isAbsolute(value));
}

function assertRequest(
  request: AndroidBuildRequest,
  workspaceRoot: string,
): void {
  const projectRoot = resolve(request.projectRoot);
  if (
    !inside(workspaceRoot, projectRoot) ||
    !inside(projectRoot, request.artifactPath)
  )
    throw new AndroidWorkerError(
      "ANDROID_REQUEST_INVALID",
      "Android worker paths must remain inside the assigned workspace.",
    );
  if (!request.job.id || request.job.platform !== "android")
    throw new AndroidWorkerError(
      "ANDROID_REQUEST_INVALID",
      "Android worker requires an Android build job with an id.",
    );
  if (!request.artifactPath)
    throw new AndroidWorkerError(
      "ANDROID_ARTIFACT_REQUIRED",
      "Android worker requests must declare the expected artifact path.",
    );
  for (const arg of request.args ?? []) {
    if (!/^(--[a-z-]+(?:=\S+)?|-P[A-Za-z0-9_.-]+=\S+)$/.test(arg))
      throw new AndroidWorkerError(
        "ANDROID_REQUEST_INVALID",
        `Unsupported Gradle argument '${arg}'.`,
      );
  }
}

export interface AndroidExecutorOptions {
  readonly workspaceRoot: string;
  readonly runner: WorkerCommandRunner;
  readonly environmentReady?: () => Promise<boolean>;
}

export async function executeAndroidBuild(
  request: AndroidBuildRequest,
  options: AndroidExecutorOptions,
): Promise<BuildResult> {
  assertRequest(request, options.workspaceRoot);
  const projectRoot = resolve(request.projectRoot);
  const ready = options.environmentReady
    ? await options.environmentReady()
    : (await inspectAndroidWorkerEnvironment(projectRoot)).ready;
  if (!ready)
    throw new AndroidWorkerError(
      "ANDROID_WORKER_NOT_READY",
      "Android worker toolchain preflight failed.",
    );
  const executable = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const result = await options.runner(
    executable,
    [request.task, "--no-daemon", ...(request.args ?? [])],
    projectRoot,
  );
  if (result.code !== 0)
    throw new AndroidWorkerError(
      "ANDROID_BUILD_FAILED",
      `Gradle exited with code ${result.code}.`,
    );
  const artifactPath = resolve(projectRoot, request.artifactPath);
  try {
    await access(artifactPath, constants.F_OK);
  } catch {
    throw new AndroidWorkerError(
      "ANDROID_ARTIFACT_MISSING",
      `Expected Android artifact was not produced: ${artifactPath}`,
    );
  }
  const content = await readFile(artifactPath);
  return {
    artifact: { name: basename(artifactPath), hash: sha256(content) },
    logs: [
      { level: "info", message: result.stdout, at: new Date().toISOString() },
      ...(result.stderr
        ? [
            {
              level: "warn",
              message: result.stderr,
              at: new Date().toISOString(),
            },
          ]
        : []),
    ],
  };
}
