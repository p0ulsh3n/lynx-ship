import { createHash, randomBytes } from "node:crypto";

export type Platform = "android" | "ios";

export type BuildState =
  | "created"
  | "uploading_source"
  | "queued"
  | "provisioning"
  | "installing_dependencies"
  | "building"
  | "signing"
  | "uploading_artifacts"
  | "success"
  | "failed"
  | "canceled"
  | "timed_out";

export type Role = "owner" | "admin" | "developer" | "viewer";

export interface ErrorDetails {
  [key: string]: unknown;
}

export class LynxShipError extends Error {
  readonly code: string;

  readonly details: ErrorDetails;

  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = "LynxShipError";
    this.code = code;
    this.details = details;
  }
}

export function assert(
  condition: unknown,
  code: string,
  message: string,
  details?: ErrorDetails,
): asserts condition {
  if (!condition) throw new LynxShipError(code, message, details);
}

export interface BuildJob {
  id: string;
  projectId: string;
  organizationId: string;
  platform: Platform;
  profile: string;
  sourceHash: string | null;
  runtimeVersion?: string;
  runtimeInputs?: Record<string, unknown>;
  state: BuildState;
  attempts: number;
  logs: Array<{ level: string; message: string; at: string }>;
  transitions: Array<{ state: BuildState; reason?: string; at: string }>;
  artifact?: {
    name: string;
    hash: string;
    path?: string;
    key?: string;
    size?: number;
    contentType?: string;
    url?: string;
    expiresAt?: string;
  };
}

export interface BuildResult {
  artifact?: { name: string; hash: string };
  logs?: Array<{ level: string; message: string; at: string }>;
}

export interface WorkerRequest {
  platform: Platform;
  capabilities?: string[];
}

export interface WorkerHandle {
  id: string;
  platform: Platform;
  providerId: string;
}

export interface SubmissionJob {
  id: string;
  projectId: string;
  organizationId: string;
  platform: Platform;
  artifact: { hash: string };
  status: string;
  createdAt: string;
  remoteId?: string;
  source?: string;
  [key: string]: unknown;
}

export interface Worker {
  id: string;
  name: string;
  organizationId: string;
  platform: Platform;
  capabilities: Record<string, unknown>;
  status: "ready" | "offline" | "draining" | "revoked";
  registeredAt: string;
  lastHeartbeatAt: string;
}

export interface Artifact {
  key: string;
  hash: string;
  size: number;
  contentType: string;
}

export interface Release {
  id: string;
  manifest: OtaManifest;
  signature: string;
  message: string;
  rollout: number;
  paused: boolean;
  createdAt: string;
  policy: { verdict: string; reason: string };
}

export interface OtaManifest {
  protocolVersion: number;
  projectId: string;
  channel: string;
  platform: Platform;
  runtimeVersion: string;
  sequence: number;
  keyId: string;
  assets: Array<{ path: string; hash: string; size: number; url?: string }>;
}

export interface Channel {
  name: string;
  projectId: string;
  releases: string[];
  current: string | null;
  lastRollback?: { releaseId: string; reason: string; at: string };
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

export interface Membership {
  organizationId: string;
  userId: string;
  role: Role;
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

export function sha256(value: string | Buffer): string {
  const hash = createHash("sha256");
  if (typeof value === "string") hash.update(value);
  else hash.update(value.toString("latin1"), "latin1");
  return hash.digest("hex");
}

export function hashJson(value: unknown): string {
  return sha256(canonicalize(value));
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString("hex")}`;
}
