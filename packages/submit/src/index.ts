import {
  assert,
  createId,
  LynxShipError,
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

type StoreTransport = (
  input: Record<string, unknown>,
) => Promise<{ remoteId: string; status: string }>;

async function unconfiguredStoreTransport(): Promise<never> {
  throw new LynxShipError(
    "SUBMISSION_TRANSPORT_REQUIRED",
    "Configure the real store transport before submitting",
  );
}

export class MockSubmissionProvider implements SubmissionProvider {
  async submit(job: SubmissionJob) {
    return { remoteId: `mock_${job.id}`, status: "submitted" };
  }
}

/** Prevents a server or production caller from silently accepting a fake job. */
export class UnconfiguredSubmissionProvider implements SubmissionProvider {
  async submit(_job: SubmissionJob): Promise<never> {
    throw new LynxShipError(
      "SUBMISSION_PROVIDER_REQUIRED",
      "Configure a real store provider or use an explicit local mock",
    );
  }
}

export class GooglePlayProvider implements SubmissionProvider {
  constructor(
    readonly transport: StoreTransport = unconfiguredStoreTransport,
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
    readonly transport: StoreTransport = unconfiguredStoreTransport,
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
  private readonly jobStore = new Map<string, SubmissionJob>();

  private readonly idempotencyStore = new Map<string, string>();

  constructor(
    readonly provider: SubmissionProvider = new UnconfiguredSubmissionProvider(),
  ) {}

  get jobs(): ReadonlyMap<string, SubmissionJob> {
    return new Map(this.jobStore);
  }

  get idempotency(): ReadonlyMap<string, string> {
    return new Map(this.idempotencyStore);
  }

  restore(
    jobs: readonly SubmissionJob[],
    idempotency: readonly (readonly [string, string])[] = [],
  ): void {
    this.jobStore.clear();
    this.idempotencyStore.clear();
    for (const job of jobs) this.jobStore.set(job.id, job);
    for (const [key, id] of idempotency) this.idempotencyStore.set(key, id);
  }

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
    if (idempotencyKey && this.idempotencyStore.has(idempotencyKey))
      return this.get(this.idempotencyStore.get(idempotencyKey)!);
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
    this.jobStore.set(job.id, job);
    if (idempotencyKey) this.idempotencyStore.set(idempotencyKey, job.id);
    Object.assign(job, await this.provider.submit(job));
    return job;
  }

  get(id: string): SubmissionJob {
    const job = this.jobStore.get(id);
    assert(job, "SUBMISSION_NOT_FOUND", "Submission not found");
    return job;
  }

  list(): SubmissionJob[] {
    return [...this.jobStore.values()];
  }
}

export * from "./real-providers.js";
