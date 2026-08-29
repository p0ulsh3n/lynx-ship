import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { sha256, type BuildResult } from "@lynxship/contracts";
import {
  IosWorkerError,
  type IosBuildRequest,
  type WorkerCommandRunner,
} from "./contracts.js";
import { inspectIosWorkerEnvironment } from "./environment.js";
import { hashIosArtifact } from "./artifact.js";

function inside(root: string, candidate: string): boolean {
  const resolvedCandidate = isAbsolute(candidate)
    ? candidate
    : resolve(root, candidate);
  const value = relative(resolve(root), resolve(resolvedCandidate));
  return value === "" || (!value.startsWith(".." + sep) && !isAbsolute(value));
}

function assertRequest(request: IosBuildRequest, workspaceRoot: string): void {
  const projectRoot = resolve(request.projectRoot);
  if (
    !inside(workspaceRoot, projectRoot) ||
    !inside(projectRoot, request.projectFile) ||
    !inside(projectRoot, request.artifactPath)
  )
    throw new IosWorkerError(
      "IOS_REQUEST_INVALID",
      "iOS worker paths must remain inside the assigned workspace.",
    );
  if (!request.job.id || request.job.platform !== "ios")
    throw new IosWorkerError(
      "IOS_REQUEST_INVALID",
      "iOS worker requires an iOS build job with an id.",
    );
  if (!request.projectFile || !request.scheme || !request.artifactPath)
    throw new IosWorkerError(
      "IOS_ARTIFACT_REQUIRED",
      "iOS worker requests must declare a project, scheme and artifact path.",
    );
  if (!/^[A-Za-z0-9_. -]+$/.test(request.scheme))
    throw new IosWorkerError(
      "IOS_REQUEST_INVALID",
      "iOS scheme contains unsupported characters.",
    );
  for (const arg of request.args ?? []) {
    if (
      !/^(CODE_SIGNING_ALLOWED|CODE_SIGN_IDENTITY|DEVELOPMENT_TEAM)=[^\s]+$/.test(
        arg,
      )
    )
      throw new IosWorkerError(
        "IOS_REQUEST_INVALID",
        `Unsupported xcodebuild override '${arg}'.`,
      );
  }
}

export interface IosExecutorOptions {
  readonly workspaceRoot: string;
  readonly runner: WorkerCommandRunner;
  readonly environmentReady?: () => Promise<boolean>;
}

export async function executeIosBuild(
  request: IosBuildRequest,
  options: IosExecutorOptions,
): Promise<BuildResult> {
  assertRequest(request, options.workspaceRoot);
  const projectRoot = resolve(request.projectRoot);
  const ready = options.environmentReady
    ? await options.environmentReady()
    : (await inspectIosWorkerEnvironment()).ready;
  if (!ready)
    throw new IosWorkerError(
      "IOS_WORKER_NOT_READY",
      "iOS worker toolchain preflight failed.",
    );
  const result = await options.runner(
    "xcodebuild",
    [
      "-project",
      request.projectFile,
      "-scheme",
      request.scheme,
      "-configuration",
      request.configuration,
      "-sdk",
      request.sdk,
      ...(request.args ?? []),
    ],
    projectRoot,
  );
  if (result.code !== 0)
    throw new IosWorkerError(
      "IOS_BUILD_FAILED",
      `xcodebuild exited with code ${result.code}.`,
    );
  const artifactPath = resolve(projectRoot, request.artifactPath);
  try {
    await access(artifactPath, constants.F_OK);
  } catch {
    throw new IosWorkerError(
      "IOS_ARTIFACT_MISSING",
      `Expected iOS artifact was not produced: ${artifactPath}`,
    );
  }
  const content = await readFile(artifactPath).catch(() => null);
  return {
    artifact: {
      name: basename(artifactPath),
      hash: content ? sha256(content) : await hashIosArtifact(artifactPath),
    },
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
