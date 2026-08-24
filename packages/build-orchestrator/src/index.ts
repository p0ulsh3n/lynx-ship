import {
  assert,
  createId,
  type BuildJob,
  type BuildState,
  type Platform,
} from "@lynxship/contracts";

export const BUILD_STATES: readonly BuildState[] = [
  "created",
  "uploading_source",
  "queued",
  "provisioning",
  "installing_dependencies",
  "building",
  "signing",
  "uploading_artifacts",
  "success",
  "failed",
  "canceled",
  "timed_out",
];

const active = new Set<BuildState>(BUILD_STATES.slice(0, 8));
const transitions: ReadonlyMap<BuildState, readonly BuildState[]> = new Map([
  ["created", ["uploading_source", "canceled"]],
  ["uploading_source", ["queued", "failed", "canceled"]],
  ["queued", ["provisioning", "failed", "canceled"]],
  [
    "provisioning",
    ["installing_dependencies", "failed", "canceled", "timed_out"],
  ],
  ["installing_dependencies", ["building", "failed", "canceled", "timed_out"]],
  ["building", ["signing", "failed", "canceled", "timed_out"]],
  ["signing", ["uploading_artifacts", "failed", "canceled", "timed_out"]],
  ["uploading_artifacts", ["success", "failed", "timed_out"]],
  ["success", []],
  ["failed", []],
  ["canceled", []],
  ["timed_out", []],
]);

export interface CreateBuildInput {
  projectId: string;
  organizationId: string;
  platform: Platform;
  profile: string;
  sourceHash?: string | null;
  runtimeVersion?: string;
  runtimeInputs?: Record<string, unknown>;
}

export function createBuild(input: CreateBuildInput): BuildJob {
  assert(
    input.projectId && input.organizationId && input.profile,
    "BUILD_INPUT",
    "Build project, organization and profile are required",
  );
  return {
    id: createId("build"),
    projectId: input.projectId,
    organizationId: input.organizationId,
    platform: input.platform,
    profile: input.profile,
    sourceHash: input.sourceHash ?? null,
    runtimeVersion: input.runtimeVersion,
    runtimeInputs: input.runtimeInputs,
    state: "created",
    transitions: [{ state: "created", at: new Date().toISOString() }],
    attempts: 0,
    logs: [],
  };
}

export function transitionBuild(
  job: BuildJob,
  next: BuildState,
  reason = "",
): BuildJob {
  assert(
    transitions.get(job.state)?.includes(next),
    "BUILD_TRANSITION_INVALID",
    `Cannot transition ${job.state} to ${next}`,
  );
  job.state = next;
  job.transitions.push({ state: next, reason, at: new Date().toISOString() });
  return job;
}

export interface BuildExecutor {
  execute(job: BuildJob): Promise<BuildJob>;
}

export class LocalBuildExecutor implements BuildExecutor {
  async execute(job: BuildJob): Promise<BuildJob> {
    for (const state of BUILD_STATES.slice(1, 8)) {
      transitionBuild(job, state, "local provider");
      job.logs.push({
        level: "info",
        message: `local:${state}`,
        at: new Date().toISOString(),
      });
    }
    job.attempts += 1;
    job.artifact = {
      name: `${job.platform}-${job.id}.artifact`,
      hash: `local-${job.id}`,
    };
    return transitionBuild(job, "success", "local provider completed");
  }
}

export class BuildOrchestrator {
  readonly jobs = new Map<string, BuildJob>();

  constructor(readonly executor: BuildExecutor = new LocalBuildExecutor()) {}

  async create(input: CreateBuildInput): Promise<BuildJob> {
    const job = createBuild(input);
    this.jobs.set(job.id, job);
    return job;
  }

  async run(id: string): Promise<BuildJob> {
    const job = this.get(id);
    assert(
      active.has(job.state) || job.state === "created",
      "BUILD_TERMINAL",
      "Build is already terminal",
    );
    return this.executor.execute(job);
  }

  cancel(id: string): BuildJob {
    const job = this.get(id);
    if (["success", "failed", "canceled", "timed_out"].includes(job.state))
      return job;
    return transitionBuild(job, "canceled", "canceled by user");
  }

  retry(id: string): BuildJob {
    const job = this.get(id);
    assert(
      ["failed", "timed_out", "canceled"].includes(job.state),
      "BUILD_RETRY_INVALID",
      "Only failed, timed out or canceled builds can be retried",
    );
    job.state = "created";
    job.transitions.push({
      state: "created",
      reason: "retry",
      at: new Date().toISOString(),
    });
    return job;
  }

  get(id: string): BuildJob {
    const job = this.jobs.get(id);
    assert(job, "BUILD_NOT_FOUND", "Build not found");
    return job;
  }

  list(): BuildJob[] {
    return [...this.jobs.values()];
  }
}

export { BuildOrchestrator as BuildService };

export class LocalBuildProvider extends LocalBuildExecutor {}

export * from "./runtime.js";

export * from "./cache.js";

export * from "./source.js";
