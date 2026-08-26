import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, type Platform } from "@lynxship/contracts";
import type { PluginReference } from "@lynxship/plugin-api";

export interface BuildProfile {
  distribution?: string;
  channel?: string;
  environment?: string;
  miso?: {
    compiler?: "ghcjs" | "microhs";
    attribute?: string;
    artifact?: string;
    microhs?: {
      version?: string;
      binary?: string;
      manifest?: string;
      manifestUrl?: string;
      cacheDir?: string;
      publicKey?: string;
      adapter?: {
        command: string;
        args?: string[];
      };
    };
  };
  android?: { artifact?: string };
  ios?: {
    configuration?: string;
    distribution?: string;
    simulator?: boolean;
    workspace?: string;
    project?: string;
    scheme?: string;
    exportOptionsPlist?: string;
    bundleScript?: string;
    appIcon?: string;
  };
  harmony?: {
    task?: string;
    module?: string;
    mode?: "project" | "module";
    product?: string;
    buildMode?: "debug" | "release";
    bundleDir?: string;
    artifact?: string;
    signTool?: string;
  };
  web?: {
    environment?: string;
    script?: string;
    artifact?: string;
  };
  desktop?: {
    script?: string;
    artifact?: string;
  };
}

export interface LynxShipConfig {
  projectId?: string;
  plugins?: PluginReference[];
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
    development: {
      distribution: "development",
      channel: "development",
      environment: "development",
      ios: { configuration: "Debug" },
    },
    simulator: {
      distribution: "development",
      channel: "development",
      environment: "development",
      ios: { configuration: "Debug", simulator: true },
    },
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
  "plugins",
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
  if (value.plugins !== undefined) {
    assert(
      Array.isArray(value.plugins),
      "CONFIG_PLUGINS",
      "plugins must be an array of package names or [package, options] tuples",
    );
    for (const plugin of value.plugins) {
      const validString = typeof plugin === "string" && plugin.length > 0;
      const validTuple =
        Array.isArray(plugin) &&
        plugin.length === 2 &&
        typeof plugin[0] === "string" &&
        plugin[0].length > 0 &&
        plugin[1] !== null &&
        typeof plugin[1] === "object" &&
        !Array.isArray(plugin[1]);
      assert(
        validString || validTuple,
        "CONFIG_PLUGINS",
        "Each plugin must be a package name or [package name, JSON options]",
      );
    }
  }
  if (value.build !== undefined) {
    assert(
      typeof value.build === "object" &&
        value.build !== null &&
        !Array.isArray(value.build),
      "CONFIG_BUILD",
      "build must be an object keyed by profile name",
    );
  }
  for (const [profileName, profile] of Object.entries(value.build ?? {})) {
    assert(
      profile !== null &&
        typeof profile === "object" &&
        !Array.isArray(profile),
      "CONFIG_PROFILE",
      `build.${profileName} must be an object`,
    );
    const miso = (profile as BuildProfile).miso;
    if (!miso) continue;
    assert(
      typeof miso === "object" && !Array.isArray(miso),
      "CONFIG_MISO",
      `build.${profileName}.miso must be an object`,
    );
    assert(
      miso.compiler === undefined ||
        miso.compiler === "ghcjs" ||
        miso.compiler === "microhs",
      "CONFIG_MISO_COMPILER",
      `build.${profileName}.miso.compiler must be ghcjs or microhs`,
    );
    if (!miso.microhs) continue;
    const microhs = miso.microhs;
    assert(
      typeof microhs === "object" && !Array.isArray(microhs),
      "CONFIG_MISO_MICROHS",
      `build.${profileName}.miso.microhs must be an object`,
    );
    assert(
      microhs.adapter === undefined ||
        (typeof microhs.adapter.command === "string" &&
          microhs.adapter.command.trim().length > 0 &&
          (microhs.adapter.args === undefined ||
            (Array.isArray(microhs.adapter.args) &&
              microhs.adapter.args.every((arg) => typeof arg === "string")))),
      "CONFIG_MISO_MICROHS_ADAPTER",
      `build.${profileName}.miso.microhs.adapter must contain a command and string args`,
    );
    assert(
      microhs.version === undefined || typeof microhs.version === "string",
      "CONFIG_MISO_MICROHS_VERSION",
      `build.${profileName}.miso.microhs.version must be a string`,
    );
    assert(
      microhs.binary === undefined || typeof microhs.binary === "string",
      "CONFIG_MISO_MICROHS_BINARY",
      `build.${profileName}.miso.microhs.binary must be a file path`,
    );
    assert(
      microhs.manifest === undefined || typeof microhs.manifest === "string",
      "CONFIG_MISO_MICROHS_MANIFEST",
      `build.${profileName}.miso.microhs.manifest must be a file path`,
    );
    assert(
      microhs.manifestUrl === undefined ||
        typeof microhs.manifestUrl === "string",
      "CONFIG_MISO_MICROHS_MANIFEST",
      `build.${profileName}.miso.microhs.manifestUrl must be a URL`,
    );
    if (microhs.manifestUrl) {
      let parsedManifestUrl: URL | undefined;
      try {
        parsedManifestUrl = new URL(microhs.manifestUrl);
      } catch {
        // The assertion below emits the stable configuration error.
      }
      assert(
        parsedManifestUrl?.protocol === "https:",
        "CONFIG_MISO_MICROHS_MANIFEST",
        `build.${profileName}.miso.microhs.manifestUrl must be a valid HTTPS URL`,
      );
    }
    assert(
      microhs.cacheDir === undefined || typeof microhs.cacheDir === "string",
      "CONFIG_MISO_MICROHS_CACHE",
      `build.${profileName}.miso.microhs.cacheDir must be a directory path`,
    );
    assert(
      microhs.publicKey === undefined || typeof microhs.publicKey === "string",
      "CONFIG_MISO_MICROHS_KEY",
      `build.${profileName}.miso.microhs.publicKey must be a PEM string`,
    );
    assert(
      !(microhs.manifest && microhs.manifestUrl),
      "CONFIG_MISO_MICROHS_MANIFEST",
      `build.${profileName}.miso.microhs must use either manifest or manifestUrl, not both`,
    );
  }
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
  const profile = config.build?.[name] ?? DEFAULT_CONFIG.build?.[name];
  assert(profile, "PROFILE_NOT_FOUND", `Build profile '${name}' was not found`);
  const inherited = DEFAULT_CONFIG.build?.[name] ?? {};
  const productionIos = config.build?.production?.ios ?? {};
  return {
    name,
    ...inherited,
    ...profile,
    ios: {
      ...(inherited.ios ?? {}),
      ...(name !== "production" ? productionIos : {}),
      ...(profile.ios ?? {}),
    },
  };
}

export function platformValue(value: string): Platform {
  assert(
    ["android", "ios", "harmony", "web", "desktop"].includes(value),
    "PLATFORM_INVALID",
    "Platform must be android, ios, harmony, web or desktop",
  );
  return value as Platform;
}
