import { assert, type Platform } from "@lynxship/contracts";
import {
  AppStoreConnectApiProvider,
  GooglePlayApiProvider,
  SubmissionService,
} from "@lynxship/submit";
import { loadCredentials } from "../secure-store.js";
import { loadConfig, type LynxShipConfig } from "../config.js";
import { submitRealArtifact } from "../remote.js";
import { saveState, type CliState } from "../runtime/state.js";
import type { BuildOrchestrator } from "@lynxship/build-orchestrator";
import type { JsonRepository } from "@lynxship/db";
import type { BoxRow, CliUi } from "../ui/index.js";

export interface SubmitCommandContext {
  root: string;
  args: string[];
  ui: CliUi;
  flag: (name: string, fallback?: string | null) => string | null;
  printValue: (
    value: unknown,
    view?: { title: string; rows: BoxRow[]; done: string },
  ) => void;
  mobilePlatformValue: (value: string) => "android" | "ios";
  requireOperationalConfiguration: (platform: Platform) => Promise<void>;
  configuredProjectId: (config: LynxShipConfig) => string;
  state: CliState;
  repository: JsonRepository<CliState>;
  builds: BuildOrchestrator;
  submissions: SubmissionService;
}

export async function runSubmit(context: SubmitCommandContext): Promise<void> {
  const {
    root,
    args,
    ui,
    flag,
    printValue,
    requireOperationalConfiguration,
    configuredProjectId,
    mobilePlatformValue,
    state,
    repository,
    builds,
    submissions,
  } = context;
  const config = await loadConfig(root);
  const platform = mobilePlatformValue(flag("--platform", "android")!);
  await requireOperationalConfiguration(platform);
  const credentials = await loadCredentials(root);
  const localMode =
    args.includes("--local") || process.env.LYNXSHIP_SUBMIT_MODE === "mock";
  const storeConfigured =
    platform === "android"
      ? Boolean(credentials.googlePlay)
      : Boolean(credentials.appStoreConnect);
  assert(
    localMode || storeConfigured,
    "STORE_SUBMISSION_REQUIRED",
    platform === "android"
      ? "Google Play is not configured. Run store configure --platform android."
      : "App Store Connect is not configured. Run store configure --platform ios.",
  );
  const candidate = builds
    .list()
    .filter((job) => job.platform === platform && job.state === "success")
    .at(-1);
  assert(candidate, "BUILD_REQUIRED", "A successful build is required");
  assert(
    localMode || candidate.artifact?.path,
    "STORE_ARTIFACT_REQUIRED",
    "A local signed artifact path is required for store submission",
  );
  const latest = args.includes("--latest");
  const spinner = ui.spinner("Submitting artifact…");
  try {
    const controlPlaneSubmission = candidate.artifact?.path
      ? await submitRealArtifact(config, state, candidate, latest)
      : await submissions.submit({
          projectId: configuredProjectId(config),
          organizationId: "local_org",
          platform,
          artifact: candidate.artifact ?? { hash: `local-${candidate.id}` },
          latest,
          buildId: latest ? null : candidate.id,
        });
    const storeResult =
      !localMode && candidate.artifact?.path
        ? platform === "android"
          ? await new GooglePlayApiProvider(credentials.googlePlay!).submit({
              platform,
              path: candidate.artifact.path,
              hash: candidate.artifact.hash,
            })
          : await new AppStoreConnectApiProvider(
              credentials.appStoreConnect!,
            ).submit({
              platform,
              path: candidate.artifact.path,
              hash: candidate.artifact.hash,
            })
        : undefined;
    const submission = storeResult
      ? {
          ...(controlPlaneSubmission as Record<string, unknown>),
          store: storeResult,
        }
      : controlPlaneSubmission;
    const result = submission as {
      id?: string;
      platform?: string;
      status?: string;
      downloadUrl?: string;
      downloadExpiresAt?: string;
    };
    spinner.succeed(
      storeResult
        ? "Artifact submitted to the configured app store"
        : "Local submission job accepted",
    );
    await saveState(state, repository, builds, submissions);
    printValue(submission, {
      title: "Submission result",
      rows: [
        {
          label: "Submission ID",
          value: result.id ?? "remote",
          valueColor: "purple",
        },
        {
          label: "Platform",
          value: result.platform ?? platform,
          valueColor: "blue",
        },
        {
          label: "Status",
          value: result.status ?? "accepted",
          valueColor: "green",
        },
      ],
      done: "App submitted to the configured provider.",
    });
    if (result.downloadUrl)
      ui.downloadArtifact(result.downloadUrl, result.downloadExpiresAt);
  } catch (error) {
    spinner.fail(error instanceof Error ? error.message : "Submission failed");
    throw error;
  }
  return;
}
