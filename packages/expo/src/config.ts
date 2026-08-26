export interface LynxShipExpoConfig {
  endpoint?: string;
  projectId?: string;
  channel?: string;
  runtimeVersion?: string;
  publicKeys?: Record<string, string>;
  embeddedBundle?: string;
  /** Relative path to the generated .lynx.bundle, normally dist/main.lynx.bundle. */
  bundlePath?: string;
  /** Copy the Lynx output into generated Android/iOS hosts during prebuild. */
  syncBundle?: boolean;
  lynxVersion?: string;
  maxReleaseBytes?: number;
}

/** Let the native package manager resolve the current Lynx SDK by default. */
const DEFAULT_LYNX_VERSION = "auto";

export function validateLynxShipExpoConfig(
  value: LynxShipExpoConfig = {},
): LynxShipExpoConfig {
  if (value.endpoint !== undefined) {
    const url = new URL(value.endpoint);
    if (url.protocol !== "https:" && !isLocalDevelopment(url.hostname))
      throw new Error(
        "LynxShip Expo endpoint must use HTTPS outside localhost",
      );
  }
  for (const [key, publicKey] of Object.entries(value.publicKeys ?? {})) {
    if (!key.trim() || !publicKey.includes("BEGIN PUBLIC KEY"))
      throw new Error("LynxShip Expo publicKeys must contain PEM public keys");
  }
  if (value.maxReleaseBytes !== undefined) {
    if (!Number.isInteger(value.maxReleaseBytes) || value.maxReleaseBytes < 1)
      throw new Error(
        "LynxShip Expo maxReleaseBytes must be a positive integer",
      );
  }
  if (value.bundlePath !== undefined) {
    if (
      typeof value.bundlePath !== "string" ||
      value.bundlePath.trim().length === 0 ||
      value.bundlePath.includes("\0")
    )
      throw new Error(
        "LynxShip Expo bundlePath must be a non-empty path without null bytes",
      );
  }
  if (value.syncBundle !== undefined && typeof value.syncBundle !== "boolean")
    throw new Error("LynxShip Expo syncBundle must be a boolean");
  if (
    value.lynxVersion !== undefined &&
    value.lynxVersion !== "auto" &&
    value.lynxVersion !== "latest" &&
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.lynxVersion)
  ) {
    throw new Error(
      "LynxShip Expo lynxVersion must be auto, latest, or an exact semver",
    );
  }
  return {
    ...value,
    channel: value.channel ?? "production",
    embeddedBundle: value.embeddedBundle ?? "main.lynx.bundle",
    bundlePath: value.bundlePath ?? "dist/main.lynx.bundle",
    syncBundle: value.syncBundle ?? true,
    lynxVersion: value.lynxVersion ?? DEFAULT_LYNX_VERSION,
  };
}

function isLocalDevelopment(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
