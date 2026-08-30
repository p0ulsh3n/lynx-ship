import {
  assert,
  canonicalize,
  type BuildJob,
  type Platform,
  type Worker,
} from "@lynxship/contracts";
import { validateSourceReference } from "@lynxship/build-orchestrator";
import type { BuildWorkItem } from "./contracts.js";

const platforms = new Set<Platform>([
  "android",
  "ios",
  "harmony",
  "web",
  "desktop",
]);

function nonEmpty(value: unknown, name: string): asserts value is string {
  assert(
    typeof value === "string" && value.length > 0 && value.length <= 512,
    "WORK_ITEM_INVALID",
    `${name} must be a non-empty string of at most 512 characters`,
  );
}

export function createBuildWorkItem(job: BuildJob): BuildWorkItem {
  nonEmpty(job.id, "buildId");
  nonEmpty(job.projectId, "projectId");
  nonEmpty(job.organizationId, "organizationId");
  nonEmpty(job.profile, "profile");
  assert(
    platforms.has(job.platform),
    "WORK_ITEM_INVALID",
    "Build platform is unsupported",
  );
  if (job.source !== undefined) validateSourceReference(job.source);
  return Object.freeze({
    schemaVersion: 1 as const,
    buildId: job.id,
    projectId: job.projectId,
    organizationId: job.organizationId,
    platform: job.platform,
    profile: job.profile,
    sourceHash: job.sourceHash ?? null,
    source: job.source,
  });
}

export function parseBuildWorkItem(value: unknown): BuildWorkItem {
  assert(
    Boolean(value) && typeof value === "object",
    "WORK_ITEM_INVALID",
    "Build queue payload must be an object",
  );
  const item = value as Record<string, unknown>;
  assert(
    item.schemaVersion === 1,
    "WORK_ITEM_INVALID",
    "Unsupported build queue payload version",
  );
  nonEmpty(item.buildId, "buildId");
  nonEmpty(item.projectId, "projectId");
  nonEmpty(item.organizationId, "organizationId");
  nonEmpty(item.profile, "profile");
  assert(
    typeof item.platform === "string" &&
      platforms.has(item.platform as Platform),
    "WORK_ITEM_INVALID",
    "Build queue payload platform is unsupported",
  );
  assert(
    item.sourceHash === null ||
      item.sourceHash === undefined ||
      (typeof item.sourceHash === "string" &&
        /^[a-f0-9]{64}$/i.test(item.sourceHash)),
    "WORK_ITEM_INVALID",
    "Build queue sourceHash must be null or a SHA-256 digest",
  );
  return Object.freeze({
    schemaVersion: 1,
    buildId: item.buildId,
    projectId: item.projectId,
    organizationId: item.organizationId,
    platform: item.platform as Platform,
    profile: item.profile,
    sourceHash: (item.sourceHash as string | null | undefined) ?? null,
    source: item.source as BuildWorkItem["source"],
  });
}

export function assertWorkItemMatchesJob(
  item: BuildWorkItem,
  job: BuildJob,
): void {
  assert(
    item.buildId === job.id &&
      item.projectId === job.projectId &&
      item.organizationId === job.organizationId &&
      item.platform === job.platform &&
      item.profile === job.profile &&
      item.sourceHash === (job.sourceHash ?? null),
    "WORK_ITEM_INVALID",
    "Build queue payload does not match the authoritative build record",
  );
  assert(
    canonicalize(item.source ?? null) === canonicalize(job.source ?? null),
    "WORK_ITEM_INVALID",
    "Build queue source reference does not match the authoritative build record",
  );
}

export function assertWorkerCanProcess(
  worker: Pick<Worker, "organizationId" | "platform">,
  job: Pick<BuildJob, "organizationId" | "platform">,
): void {
  assert(
    worker.organizationId === job.organizationId,
    "WORKER_ORGANIZATION_MISMATCH",
    "Worker organization does not match the build organization",
  );
  assert(
    worker.platform === job.platform,
    "WORKER_PLATFORM_MISMATCH",
    "Worker platform does not match the build platform",
  );
}
