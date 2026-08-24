import {
  assert,
  type BuildJob,
  type BuildResult,
  type WorkerHandle,
  type WorkerRequest,
} from "@lynxship/contracts";

export interface BuildProvider {
  readonly id: string;
  provision?(request: WorkerRequest): Promise<WorkerHandle>;
  acquire(job: BuildJob): Promise<WorkerHandle>;
  execute(worker: WorkerHandle, job: BuildJob): Promise<BuildResult>;
  release(worker: WorkerHandle, result: BuildResult): Promise<void>;
  destroy?(worker: WorkerHandle): Promise<void>;
}

export class LocalBuildProvider implements BuildProvider {
  readonly id = "local";

  async provision(request: WorkerRequest): Promise<WorkerHandle> {
    return {
      id: `local-${request.platform}`,
      platform: request.platform,
      providerId: this.id,
    };
  }

  async acquire(job: BuildJob): Promise<WorkerHandle> {
    return this.provision!({ platform: job.platform });
  }

  async execute(worker: WorkerHandle, job: BuildJob): Promise<BuildResult> {
    assert(
      worker.platform === job.platform,
      "PROVIDER_PLATFORM",
      "Worker platform does not match build",
    );
    return {
      artifact: {
        name: `${job.platform}-${job.id}.artifact`,
        hash: `local-${job.id}`,
      },
    };
  }

  async release(): Promise<void> {}
}

export class ProviderCatalog {
  readonly providers = new Map<string, BuildProvider>();

  register(provider: BuildProvider): BuildProvider {
    assert(provider.id, "PROVIDER_INPUT", "Provider id is required");
    this.providers.set(provider.id, provider);
    return provider;
  }

  get(id: string): BuildProvider {
    const provider = this.providers.get(id);
    assert(provider, "PROVIDER_NOT_FOUND", "Provider not found");
    return provider;
  }

  list(): BuildProvider[] {
    return [...this.providers.values()];
  }
}
