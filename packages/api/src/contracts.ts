import { assert, type Platform } from "@lynxship/contracts";

export interface BuildRequest {
  projectId: string;
  organizationId: string;
  platform: Platform;
  profile: string;
  sourceHash?: string | null;
}

export function validateBuildRequest(value: unknown): BuildRequest {
  assert(
    value && typeof value === "object",
    "CONTRACT_INVALID",
    "Build request must be an object",
  );
  const input = value as Partial<BuildRequest>;
  assert(
    typeof input.projectId === "string" &&
      typeof input.organizationId === "string" &&
      typeof input.profile === "string",
    "CONTRACT_INVALID",
    "Build request requires projectId, organizationId and profile",
  );
  assert(
    input.platform === "android" ||
      input.platform === "ios" ||
      input.platform === "harmony" ||
      input.platform === "web" ||
      input.platform === "desktop",
    "CONTRACT_INVALID",
    "Build request platform is invalid",
  );
  return {
    projectId: input.projectId,
    organizationId: input.organizationId,
    platform: input.platform,
    profile: input.profile,
    sourceHash: input.sourceHash ?? null,
  };
}

export function validateOtaCheckQuery(
  value: Record<string, string | undefined>,
): {
  projectId: string;
  channel: string;
  platform: Platform;
  runtimeVersion: string;
  installationId?: string;
} {
  assert(
    typeof value.projectId === "string" &&
      typeof value.channel === "string" &&
      typeof value.runtimeVersion === "string" &&
      (value.platform === "android" || value.platform === "ios"),
    "CONTRACT_INVALID",
    "OTA check requires projectId, channel, platform and runtimeVersion",
  );
  assert(
    typeof value.projectId === "string",
    "CONTRACT_INVALID",
    "OTA projectId is required",
  );
  assert(
    typeof value.channel === "string",
    "CONTRACT_INVALID",
    "OTA channel is required",
  );
  assert(
    typeof value.runtimeVersion === "string",
    "CONTRACT_INVALID",
    "OTA runtimeVersion is required",
  );
  return {
    projectId: value.projectId,
    channel: value.channel,
    platform: value.platform,
    runtimeVersion: value.runtimeVersion,
    installationId: value.installationId,
  };
}
