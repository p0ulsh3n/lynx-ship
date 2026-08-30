import { RedisQueue } from "@lynxship/queue";
import type { BuildJob, BuildSourceReference } from "@lynxship/contracts";
import {
  BuildWorkerService,
  HttpWorkerArtifactUploader,
  HttpWorkerBuildLoader,
  HttpWorkerReporter,
  HttpWorkerSourceLoader,
  type BuildWorkerExecutor,
  type WorkerReporter,
} from "@lynxship/worker-service";
import type { HostedWorkerConfig } from "./config.js";

export interface HostedWorkerDependencies {
  readonly queue: RedisQueue;
  readonly reporter: WorkerReporter;
  readonly loadBuild: (buildId: string) => Promise<BuildJob | null>;
  readonly loadSource: (
    buildId: string,
    workerId: string,
    reference: BuildSourceReference,
  ) => Promise<Buffer>;
  readonly uploadArtifact: (
    buildId: string,
    workerId: string,
    content: Buffer,
    contentType: string,
  ) => Promise<NonNullable<BuildJob["artifact"]>>;
}

export function createHostedWorkerService(
  config: HostedWorkerConfig,
  executor: BuildWorkerExecutor,
  dependencies: HostedWorkerDependencies,
): BuildWorkerService {
  return new BuildWorkerService({
    queue: dependencies.queue,
    queueName: config.queueName,
    worker: {
      id: config.workerId,
      organizationId: config.organizationId,
      platform: config.platform,
    },
    reporter: dependencies.reporter,
    loadBuild: dependencies.loadBuild,
    loadSource: (reference, job, _signal) =>
      dependencies.loadSource(job.id, config.workerId, reference),
    uploadArtifact: dependencies.uploadArtifact,
    sourceWorkspaceRoot: config.sourceWorkspaceRoot,
    executor,
    onError: (error) => console.error("LynxShip worker error", error),
    onRuntimeError: (error) =>
      console.error("LynxShip worker runtime error", error),
  });
}

export async function connectHostedWorker(
  config: HostedWorkerConfig,
  executor: BuildWorkerExecutor,
): Promise<{ service: BuildWorkerService; queue: RedisQueue }> {
  const queue = new RedisQueue(config.redisUrl, config.queuePrefix, "workers");
  await queue.initialize();
  const transport = {
    baseUrl: config.apiUrl,
    token: config.token,
    allowInsecureLocalhost: config.allowInsecureLocalhost,
  } as const;
  const reporter = new HttpWorkerReporter(transport);
  const buildLoader = new HttpWorkerBuildLoader(transport);
  const sourceLoader = new HttpWorkerSourceLoader(transport);
  const artifactUploader = new HttpWorkerArtifactUploader(transport);
  return {
    queue,
    service: createHostedWorkerService(config, executor, {
      queue,
      reporter,
      loadBuild: (buildId) => buildLoader.load(buildId, config.workerId),
      loadSource: (buildId, workerId, reference) =>
        sourceLoader.load(buildId, workerId, reference),
      uploadArtifact: (buildId, workerId, content, contentType) =>
        artifactUploader.upload(buildId, workerId, content, contentType),
    }),
  };
}
