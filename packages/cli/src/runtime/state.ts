import { createSigningKey, type SigningKey } from "@lynxship/signing";
import type { BuildJob, Platform, SubmissionJob } from "@lynxship/contracts";
import { JsonRepository } from "@lynxship/db";
import {
  BuildOrchestrator,
  LocalBuildExecutor,
} from "@lynxship/build-orchestrator";
import { MockSubmissionProvider, SubmissionService } from "@lynxship/submit";
import type { RemoteCliState } from "../remote.js";
import { join } from "node:path";

export interface CliRelease {
  id: string;
  manifest: {
    protocolVersion: number;
    projectId: string;
    channel: string;
    platform: Platform;
    runtimeVersion: string;
    sequence: number;
    keyId: string;
    assets: Array<{ path: string; hash: string; size: number; url?: string }>;
  };
  signature: string;
  message: string;
  createdAt: string;
}

export interface CliState extends RemoteCliState {
  builds: BuildJob[];
  submissions: SubmissionJob[];
  releases: CliRelease[];
  signingKey: SigningKey | null;
  lastRollback?: { releaseId: string; reason: string; at: string };
}

export interface LoadedCliState {
  state: CliState;
  repository: JsonRepository<CliState>;
  builds: BuildOrchestrator;
  submissions: SubmissionService;
}

let stateSaveQueue = Promise.resolve();

export async function loadState(root: string): Promise<LoadedCliState> {
  const repository = new JsonRepository<CliState>(
    join(root, ".lynxship", "state.json"),
    {
      builds: [],
      submissions: [],
      releases: [],
      signingKey: null,
    },
  );
  const state = await repository.read();
  state.builds ??= [];
  state.submissions ??= [];
  state.releases ??= [];
  state.signingKey ??= createSigningKey();

  const builds = new BuildOrchestrator(new LocalBuildExecutor());
  builds.restore(state.builds);
  const submissions = new SubmissionService(new MockSubmissionProvider());
  submissions.restore(state.submissions);
  return { state, repository, builds, submissions };
}

export async function saveState(
  state: CliState,
  repository: JsonRepository<CliState>,
  builds: BuildOrchestrator,
  submissions: SubmissionService,
): Promise<void> {
  const next = stateSaveQueue.then(async () => {
    state.builds = builds.list();
    state.submissions = submissions.list();
    await repository.write(state);
  });
  stateSaveQueue = next.catch(() => undefined);
  await next;
}
