import type { BuildJob, Platform } from "@lynxship/contracts";
import { createSourceSnapshot } from "@lynxship/build-orchestrator";
import type { BuildSourceReference } from "@lynxship/contracts";
import type { LynxShipConfig } from "../config.js";
import {
  createRemoteBuild,
  uploadBuildSource,
  waitForRemoteBuild,
  type RemoteCliState,
} from "../remote.js";
import { saveState, type CliState } from "../runtime/state.js";
import type { LoadedCliState } from "../runtime/state.js";
import type { BoxRow } from "../ui/components.js";

const maxRemoteSourceBytes = 72 * 1024 * 1024;

export interface RemoteBuildOptions {
  root: string;
  config: LynxShipConfig;
  state: CliState & RemoteCliState;
  loaded: LoadedCliState;
  platform: Platform;
  profile: string;
  wait: boolean;
  source?: BuildSourceReference;
  printValue: (
    value: unknown,
    view?: { title: string; rows: BoxRow[]; done: string },
  ) => void;
  ui: {
    info(message: string): void;
    progress(label: string): {
      update(value?: number, label?: string): void;
      event(message: string): void;
      stop(): void;
    };
  };
}

export async function executeRemoteBuild(
  options: RemoteBuildOptions,
): Promise<BuildJob> {
  const progress = options.ui.progress("Remote LynxShip build");
  try {
    const source =
      options.source ??
      (await prepareRemoteSource(
        options.root,
        options.config,
        options.state,
        progress,
      ));
    progress.update(undefined, "Queueing the remote build…");
    const created = await createRemoteBuild(options.config, options.state, {
      platform: options.platform,
      profile: options.profile,
      source,
    });
    rememberRemoteJob(options.loaded, created);
    await saveState(
      options.state,
      options.loaded.repository,
      options.loaded.builds,
      options.loaded.submissions,
    );

    if (!options.wait) {
      progress.update(100, "Remote build queued");
      printRemoteBuild(options, created, source);
      return created;
    }

    progress.update(undefined, `Waiting for remote build ${created.id}…`);
    const result = await waitForRemoteBuild(options.config, created.id, {
      pollMs: 2_000,
    });
    rememberRemoteJob(options.loaded, result);
    await saveState(
      options.state,
      options.loaded.repository,
      options.loaded.builds,
      options.loaded.submissions,
    );
    progress.update(100, `Remote build ${result.state}`);
    printRemoteBuild(options, result, source);
    if (result.state === "failed" || result.state === "timed_out")
      process.exitCode = 5;
    return result;
  } finally {
    progress.stop();
  }
}

export async function prepareRemoteSource(
  root: string,
  config: LynxShipConfig,
  state: RemoteCliState,
  progress?: { update(value?: number, label?: string): void },
): Promise<BuildSourceReference> {
  progress?.update(undefined, "Creating a reproducible source snapshot…");
  const snapshot = await createSourceSnapshot(root);
  if (snapshot.bytes.length > maxRemoteSourceBytes)
    throw new Error(
      `Remote source snapshot is ${(snapshot.bytes.length / 1024 / 1024).toFixed(1)} MiB; the current JSON upload limit is ${maxRemoteSourceBytes / 1024 / 1024} MiB. Remove generated or unnecessary files and retry.`,
    );
  progress?.update(undefined, "Uploading the verified source snapshot…");
  return uploadBuildSource(config, state, snapshot.bytes);
}

function rememberRemoteJob(loaded: LoadedCliState, job: BuildJob): void {
  loaded.builds.restore([
    ...loaded.builds.list().filter((candidate) => candidate.id !== job.id),
    job,
  ]);
}

function printRemoteBuild(
  options: RemoteBuildOptions,
  job: BuildJob,
  source: BuildSourceReference,
): void {
  options.ui.info(
    `Remote build ${job.id}: ${job.state} · source ${source.hash.slice(0, 12)}… (${source.fileCount} files)`,
  );
  options.printValue(
    { ...job, source },
    {
      title: "Remote build result",
      rows: [
        { label: "Build ID", value: job.id, valueColor: "purple" },
        { label: "Platform", value: job.platform, valueColor: "blue" },
        { label: "Profile", value: job.profile, valueColor: "text" },
        {
          label: "Status",
          value: job.state,
          valueColor: job.state === "success" ? "green" : "yellow",
        },
      ],
      done:
        job.state === "success"
          ? "Remote build complete. Run lynxship submit --latest to publish it."
          : job.state === "created" || job.state === "queued"
            ? "Remote build queued. Run lynxship build status <id> to check it."
            : "Remote build did not complete successfully. Review the worker logs and retry it.",
    },
  );
}
