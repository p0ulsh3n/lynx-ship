import {
  assert,
  createId,
  type Platform,
  type SubmissionJob,
} from "@lynxship/contracts";

export interface SubmissionInput {
  projectId: string;
  organizationId: string;
  platform: Platform;
  artifact: { hash: string };
  buildId?: string | null;
  latest?: boolean;
  path?: string | null;
  url?: string | null;
  idempotencyKey?: string | null;
  [key: string]: unknown;
}

export interface SubmissionProvider {
  submit(job: SubmissionJob): Promise<{ remoteId: string; status: string }>;
}

export interface ProviderSubmissionInput {
  platform: Platform;
  artifact: { hash: string };
  applicationId?: string;
  track?: string;
  bundleIdentifier?: string;
  ascAppId?: string;
}

export class MockSubmissionProvider implements SubmissionProvider {
  async submit(job: SubmissionJob) {
    return { remoteId: `mock_${job.id}`, status: "submitted" };
  }
}

export class GooglePlayProvider implements SubmissionProvider {
  constructor(
    readonly transport: (
      input: Record<string, unknown>,
    ) => Promise<{ remoteId: string; status: string }> = async () => ({
      status: "accepted",
      remoteId: "sandbox-google",
    }),
  ) {}

  async submit(job: ProviderSubmissionInput) {
    assert(
      job.platform === "android",
      "SUBMISSION_PLATFORM",
      "Google Play accepts Android jobs only",
    );
    assert(
      typeof job.applicationId === "string" && typeof job.track === "string",
      "GOOGLE_PLAY_INPUT",
      "applicationId and track are required",
    );
    return this.transport({
      endpoint: `/androidpublisher/v3/applications/${job.applicationId}/edits`,
      track: job.track,
      artifact: job.artifact,
    });
  }
}

export class AppStoreConnectProvider implements SubmissionProvider {
  constructor(
    readonly transport: (
      input: Record<string, unknown>,
    ) => Promise<{ remoteId: string; status: string }> = async () => ({
      status: "processing",
      remoteId: "sandbox-asc",
    }),
  ) {}

  async submit(job: ProviderSubmissionInput) {
    assert(
      job.platform === "ios",
      "SUBMISSION_PLATFORM",
      "App Store Connect accepts iOS jobs only",
    );
    assert(
      typeof job.bundleIdentifier === "string" &&
        typeof job.ascAppId === "string",
      "ASC_INPUT",
      "bundleIdentifier and ascAppId are required",
    );
    return this.transport({
      endpoint: "/v1/builds",
      bundleIdentifier: job.bundleIdentifier,
      ascAppId: job.ascAppId,
      artifact: job.artifact,
    });
  }
}

export class SubmissionService {
  readonly jobs = new Map<string, SubmissionJob>();

  idempotency = new Map<string, string>();

  constructor(
    readonly provider: SubmissionProvider = new MockSubmissionProvider(),
  ) {}

  async submit(input: SubmissionInput): Promise<SubmissionJob> {
    const {
      projectId,
      organizationId,
      platform,
      artifact,
      buildId,
      latest,
      path,
      url,
      idempotencyKey,
      ...providerInput
    } = input;
    assert(
      artifact?.hash,
      "SUBMISSION_ARTIFACT",
      "A hashed artifact is required",
    );
    const sources = [buildId, latest, path, url].filter(Boolean);
    assert(
      sources.length <= 1,
      "SUBMISSION_SOURCE",
      "Exactly one external artifact source may be selected",
    );
    if (idempotencyKey && this.idempotency.has(idempotencyKey))
      return this.get(this.idempotency.get(idempotencyKey)!);
    const job: SubmissionJob = {
      id: createId("sub"),
      projectId,
      organizationId,
      platform,
      artifact,
      ...providerInput,
      source: buildId
        ? "build"
        : latest
          ? "latest"
          : path
            ? "path"
            : url
              ? "url"
              : "artifact",
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    if (idempotencyKey) this.idempotency.set(idempotencyKey, job.id);
    Object.assign(job, await this.provider.submit(job));
    return job;
  }

  get(id: string): SubmissionJob {
    const job = this.jobs.get(id);
    assert(job, "SUBMISSION_NOT_FOUND", "Submission not found");
    return job;
  }

  list(): SubmissionJob[] {
    return [...this.jobs.values()];
  }
}

export * from "./real-providers.js";
