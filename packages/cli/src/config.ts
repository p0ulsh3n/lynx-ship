import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, type Platform } from "@lynxship/contracts";

export interface BuildProfile {
  distribution?: string;
  channel?: string;
  environment?: string;
  android?: { artifact?: string };
  ios?: {
    configuration?: string;
    distribution?: string;
    workspace?: string;
    project?: string;
    scheme?: string;
    exportOptionsPlist?: string;
    bundleScript?: string;
  };
}

export interface LynxShipConfig {
  projectId?: string;
  cli?: {
    apiUrl?: string;
    organizationId?: string;
    token?: string;
  };
  runtimeVersion?: { policy: "fingerprint" | "manual"; value?: string };
  build?: Record<string, BuildProfile>;
  update?: {
    protocolVersion?: number;
    channel?: string;
    rollout?: { defaultPercentage?: number };
  };
  [key: string]: unknown;
}

export const DEFAULT_CONFIG: LynxShipConfig = {
  runtimeVersion: { policy: "fingerprint" },
  build: {
    production: {
      distribution: "store",
      channel: "production",
      environment: "production",
    },
  },
  update: { protocolVersion: 1, channel: "production" },
};

const allowedRootKeys = new Set([
  "$schema",
  "projectId",
  "cli",
  "runtimeVersion",
  "build",
  "submit",
  "update",
  "artifacts",
]);

export function validateConfig(
  config: unknown,
  options: { ci?: boolean } = {},
): LynxShipConfig {
  assert(
    config && typeof config === "object" && !Array.isArray(config),
    "CONFIG_INVALID",
    "lynxship.json must contain an object",
  );
  const value = config as LynxShipConfig;
  const unknown = Object.keys(value).filter((key) => !allowedRootKeys.has(key));
  assert(
    !options.ci || unknown.length === 0,
    "CONFIG_UNKNOWN_KEY",
    `Unknown configuration key(s): ${unknown.join(", ")}`,
    { unknown },
  );
  if (value.projectId !== undefined)
    assert(
      typeof value.projectId === "string" && value.projectId.length > 0,
      "CONFIG_PROJECT_ID",
      "projectId must be a non-empty string",
    );
  assert(
    value.runtimeVersion?.policy === undefined ||
      ["fingerprint", "manual"].includes(value.runtimeVersion.policy),
    "CONFIG_RUNTIME_POLICY",
    "runtimeVersion.policy must be fingerprint or manual",
  );
  if (value.runtimeVersion?.policy === "manual")
    assert(
      typeof value.runtimeVersion.value === "string" &&
        value.runtimeVersion.value.length > 0,
      "CONFIG_RUNTIME_VALUE",
      "runtimeVersion.value is required when runtimeVersion.policy is manual",
    );
  const percentage = value.update?.rollout?.defaultPercentage;
  if (percentage !== undefined)
    assert(
      Number.isInteger(percentage) && percentage >= 0 && percentage <= 100,
      "CONFIG_ROLLOUT",
      "rollout percentage must be an integer between 0 and 100",
    );
  return value;
}

export async function loadConfig(
  root: string,
  options: { ci?: boolean } = {},
): Promise<LynxShipConfig> {
  try {
    return validateConfig(
      JSON.parse(await readFile(join(root, "lynxship.json"), "utf8")),
      options,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return validateConfig(DEFAULT_CONFIG, options);
    if (error instanceof SyntaxError)
      throw new Error(`Invalid JSON in ${join(root, "lynxship.json")}`);
    throw error;
  }
}

export function resolveProfile(
  config: LynxShipConfig,
  name = "production",
): BuildProfile & { name: string } {
  const profile = config.build?.[name];
  assert(profile, "PROFILE_NOT_FOUND", `Build profile '${name}' was not found`);
  return { name, ...profile };
}

export function platformValue(value: string): Platform {
  assert(
    value === "android" || value === "ios",
    "PLATFORM_INVALID",
    "Platform must be android or ios",
  );
  return value;
}
