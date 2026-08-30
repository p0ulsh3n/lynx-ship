import { createRequire } from "node:module";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { assert, type BuildJob, type BuildResult } from "@lynxship/contracts";
import type { BuildWorkerExecutor } from "@lynxship/worker-service";

const require = createRequire(import.meta.url);
const outputLimit = 4 * 1024 * 1024;

export interface CliProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CliProcessRunner = (
  executable: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
) => Promise<CliProcessResult>;

export interface CliWorkerExecutorOptions {
  readonly cliEntry?: string;
  readonly runner?: CliProcessRunner;
  readonly timeoutMs?: number;
}

/**
 * Runs the same validated LynxShip native pipeline used locally inside a
 * disposable worker workspace, then publishes the resulting bytes through
 * the worker-bound artifact channel.
 */
export function createCliWorkerExecutor(
  options: CliWorkerExecutorOptions = {},
): BuildWorkerExecutor {
  const runner = options.runner ?? runCliProcess;
  const timeoutMs = options.timeoutMs ?? 60 * 60 * 1_000;
  assert(
    Number.isInteger(timeoutMs) &&
      timeoutMs >= 10_000 &&
      timeoutMs <= 24 * 60 * 60 * 1_000,
    "WORKER_EXECUTOR_TIMEOUT",
    "Worker CLI timeout must be between 10 seconds and 24 hours",
  );
  const cliEntry = options.cliEntry ?? require.resolve("@lynxship/cli");

  return {
    async execute(job, context): Promise<BuildResult> {
      const root = context.sourceWorkspace;
      assert(
        root,
        "WORKER_SOURCE_REQUIRED",
        "The CLI worker executor requires a materialized source workspace",
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const abortFromWorker = (): void => controller.abort();
      if (context.signal.aborted) abortFromWorker();
      else
        context.signal.addEventListener("abort", abortFromWorker, {
          once: true,
        });
      const report = context.report;
      try {
        await report({ state: "uploading_source" });
        await report({ state: "queued" });
        await report({ state: "provisioning" });
        await report({ state: "installing_dependencies" });
        await report({ state: "building" });
        const result = await runner(
          process.execPath,
          [
            cliEntry,
            "build",
            "--platform",
            job.platform,
            "--profile",
            job.profile,
            "--no-upload",
            "--non-interactive",
            "--json",
          ],
          root,
          controller.signal,
        );
        if (result.code !== 0)
          throw new Error(
            `LynxShip CLI exited with code ${result.code}: ${tail(result.stderr || result.stdout)}`,
          );
        await report({ state: "signing" });
        const localArtifact = await findLocalArtifact(root, job);
        const upload = context.uploadArtifact;
        assert(
          upload,
          "WORKER_ARTIFACT_REQUIRED",
          "The worker CLI executor requires an artifact uploader",
        );
        await report({ state: "uploading_artifacts" });
        const artifact = await upload(
          await readFile(localArtifact.path),
          localArtifact.contentType,
        );
        await report({ state: "success", artifact });
        return { artifact };
      } finally {
        clearTimeout(timeout);
        context.signal.removeEventListener("abort", abortFromWorker);
        if (context.signal.aborted) controller.abort();
      }
    },
  };
}

async function findLocalArtifact(
  root: string,
  job: BuildJob,
): Promise<{ path: string; contentType: string }> {
  const stateFile = resolve(root, ".lynxship", "state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8")) as {
    builds?: Array<BuildJob>;
  };
  const candidates = (state.builds ?? [])
    .filter(
      (candidate) =>
        candidate.platform === job.platform &&
        candidate.profile === job.profile &&
        candidate.state === "success" &&
        typeof candidate.artifact?.path === "string",
    )
    .reverse();
  const artifactPath = candidates[0]?.artifact?.path;
  assert(
    artifactPath,
    "WORKER_ARTIFACT_MISSING",
    "The LynxShip CLI completed without a local artifact path",
  );
  const path = resolve(artifactPath);
  assert(
    inside(root, path),
    "WORKER_ARTIFACT_INVALID",
    "Worker artifact path escapes the disposable source workspace",
  );
  await access(path, constants.F_OK);
  return { path, contentType: artifactContentType(basename(path)) };
}

function artifactContentType(name: string): string {
  if (name.endsWith(".apk")) return "application/vnd.android.package-archive";
  if (name.endsWith(".aab")) return "application/octet-stream";
  if (name.endsWith(".ipa")) return "application/octet-stream";
  if (name.endsWith(".hap")) return "application/octet-stream";
  return "application/octet-stream";
}

function inside(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value === "" || (!value.startsWith(".." + sep) && !isAbsolute(value));
}

async function runCliProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
): Promise<CliProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let overflowed = false;
    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (stdout.length + stderr.length + chunk.length > outputLimit) {
        overflowed = true;
        child.kill("SIGTERM");
        return;
      }
      if (target === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    const abort = (): void => {
      child.kill("SIGTERM");
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (overflowed)
        return reject(new Error("Worker CLI output exceeded its safety limit"));
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}

function tail(value: string): string {
  return value.slice(-2_000).replace(/[\r\n]+/g, " ");
}
