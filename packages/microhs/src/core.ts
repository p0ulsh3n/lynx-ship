import { homedir } from "node:os";
import { join } from "node:path";

export const MICROHS_MANIFEST_VERSION = 1 as const;

export type MicroHsHostTriple =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win32-x64";

export interface MicroHsArtifact {
  url: string;
  sha256: string;
  signatureUrl?: string;
  signatureBase64?: string;
}

export interface MicroHsReleaseManifest {
  schemaVersion: typeof MICROHS_MANIFEST_VERSION;
  version: string;
  sourceCommit: string;
  artifacts: Partial<Record<MicroHsHostTriple, MicroHsArtifact>>;
}

export interface MicroHsAcquireOptions {
  version?: string;
  binaryPath?: string;
  manifestPath?: string;
  manifestUrl?: string;
  cacheDir?: string;
  publicKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  arch?: string;
}

export interface MicroHsToolchain {
  binaryPath: string;
  hostTriple: MicroHsHostTriple;
  version: string;
  source: "path" | "cache" | "download";
  sha256?: string;
}

export class MicroHsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MicroHsError";
    this.code = code;
  }
}

export const supportedTriples = new Set<MicroHsHostTriple>([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);

export function assertMicroHs(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new MicroHsError(code, message);
}

export function microHsHostTriple(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): MicroHsHostTriple {
  const normalizedArch = arch === "ia32" ? "x86" : arch;
  const triple = `${platform}-${normalizedArch}`;
  assertMicroHs(
    supportedTriples.has(triple as MicroHsHostTriple),
    "MICROHS_HOST_UNSUPPORTED",
    `MicroHs has no verified LynxShip binary for ${triple}. Supported hosts: ${[...supportedTriples].join(", ")}.`,
  );
  return triple as MicroHsHostTriple;
}

export function defaultMicroHsCacheDir(): string {
  return process.platform === "win32"
    ? join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
        "LynxShip",
        "microhs",
      )
    : join(
        process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
        "lynxship",
        "microhs",
      );
}
