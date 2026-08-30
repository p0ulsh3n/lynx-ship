import type {
  BuildJob,
  BuildSourceReference,
  Platform,
} from "@lynxship/contracts";
import {
  decodeSourceSnapshot,
  SOURCE_SNAPSHOT_CONTENT_TYPE,
} from "@lynxship/build-orchestrator";
import { sha256 } from "@lynxship/contracts";
import type { LynxShipConfig } from "./config.js";

export interface RemoteCliState {
  remoteOrganizationId?: string;
  remoteProjectId?: string;
}

export interface OtaPublishRequest {
  projectId: string;
  organizationId: string;
  channel: string;
  platform: Platform;
  runtimeVersion: string;
  assets: Array<{ path: string; hash: string; size: number; url: string }>;
  message?: string;
  rollout?: number;
  policyApprovalId?: string | null;
}

export interface OtaRollbackRequest {
  projectId: string;
  channel: string;
  platform: Platform;
  releaseId: string;
  reason: string;
}

interface RemoteOptions {
  apiUrl?: string;
  token?: string;
}

export class RemoteApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RemoteApiError";
  }
}

export interface RemoteBuildInput {
  platform: Platform;
  profile: string;
  source: BuildSourceReference;
  idempotencyKey?: string;
}

function apiUrl(options: RemoteOptions): string {
  return (
    options.apiUrl ??
    process.env.LYNXSHIP_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");
}

async function request<T>(
  options: RemoteOptions,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const response = await fetch(`${apiUrl(options)}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let body: (T & { message?: string; error?: string }) | undefined;
  try {
    body = JSON.parse(text) as T & { message?: string; error?: string };
  } catch {
    body = undefined;
  }
  if (!response.ok)
    throw new RemoteApiError(
      response.status,
      `LynxShip API ${response.status}: ${body?.message ?? body?.error ?? response.statusText}`,
      body?.error,
    );
  if (!body) throw new Error("LynxShip API returned invalid JSON");
  return body;
}

export async function ensureRemoteTarget(
  config: LynxShipConfig,
  state: RemoteCliState,
): Promise<{ organizationId: string; projectId: string }> {
  const projectName = config.projectId;
  if (!projectName)
    throw new Error(
      "lynxship.json must contain projectId. Run `lynxship init` first.",
    );
  const options = {
    apiUrl: config.cli?.apiUrl,
    token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
  };
  let organizationId =
    state.remoteOrganizationId ??
    config.cli?.organizationId ??
    process.env.LYNXSHIP_ORGANIZATION_ID;
  if (!organizationId) {
    const organization = await request<{ id: string }>(
      options,
      "/v1/organizations",
      {
        method: "POST",
        body: JSON.stringify({
          name: `${projectName} organization`,
          ownerUserId: "cli",
        }),
      },
    );
    organizationId = organization.id;
    state.remoteOrganizationId = organizationId;
  }

  let projectId = state.remoteProjectId;
  if (!projectId) {
    const projects = await request<Array<{ id: string; name: string }>>(
      options,
      `/v1/projects?organizationId=${encodeURIComponent(organizationId)}`,
    );
    projectId = projects.find((project) => project.name === projectName)?.id;
    if (!projectId) {
      const project = await request<{ id: string }>(options, "/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name: projectName,
        }),
      });
      projectId = project.id;
    }
    state.remoteProjectId = projectId;
  }

  return { organizationId, projectId };
}

export async function uploadBuildSource(
  config: LynxShipConfig,
  state: RemoteCliState,
  bytes: Buffer,
): Promise<BuildSourceReference> {
  const target = await ensureRemoteTarget(config, state);
  let directSource: BuildSourceReference | undefined;
  try {
    const snapshot = decodeSourceSnapshot(bytes);
    directSource = {
      key: `sources/${sha256(bytes)}`,
      hash: sha256(bytes),
      size: bytes.length,
      contentType: SOURCE_SNAPSHOT_CONTENT_TYPE,
      fileCount: snapshot.files.length,
    };
    const plan = await request<{
      source: BuildSourceReference;
      upload: {
        method: "PUT";
        url: string;
        headers: Record<string, string>;
      };
    }>(
      {
        apiUrl: config.cli?.apiUrl,
        token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
      },
      "/v1/build-sources/upload-plan",
      {
        method: "POST",
        body: JSON.stringify({ ...target, source: directSource }),
      },
    );
    const uploaded = await fetch(plan.upload.url, {
      method: plan.upload.method,
      headers: plan.upload.headers,
      body: Uint8Array.from(bytes),
    });
    if (!uploaded.ok)
      throw new Error(
        `Direct source upload failed with HTTP ${uploaded.status}`,
      );
    const completed = await request<{ source: BuildSourceReference }>(
      {
        apiUrl: config.cli?.apiUrl,
        token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
      },
      "/v1/build-sources/complete",
      {
        method: "POST",
        body: JSON.stringify({ ...target, source: plan.source }),
      },
    );
    return completed.source;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (
      !(
        (error instanceof RemoteApiError &&
          (error.status === 404 ||
            error.code === "SOURCE_DIRECT_UPLOAD_UNAVAILABLE")) ||
        code === "SOURCE_SNAPSHOT_INVALID"
      )
    )
      throw error;
  }
  const response = await request<{ source: BuildSourceReference }>(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    "/v1/build-sources",
    {
      method: "POST",
      body: JSON.stringify({
        ...target,
        dataBase64: bytes.toString("base64"),
      }),
    },
  );
  return response.source;
}

export async function createRemoteBuild(
  config: LynxShipConfig,
  state: RemoteCliState,
  input: RemoteBuildInput,
): Promise<BuildJob> {
  const target = await ensureRemoteTarget(config, state);
  return request<BuildJob>(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    "/v1/builds",
    {
      method: "POST",
      body: JSON.stringify({
        ...target,
        platform: input.platform,
        profile: input.profile,
        source: input.source,
        sourceHash: input.source.hash,
        idempotencyKey:
          input.idempotencyKey ??
          "cli:" +
            input.platform +
            ":" +
            input.profile +
            ":" +
            input.source.hash,
      }),
    },
  );
}

export async function getRemoteBuild(
  config: LynxShipConfig,
  id: string,
): Promise<BuildJob> {
  return request<BuildJob>(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    "/v1/builds/" + encodeURIComponent(id),
  );
}

export async function listRemoteBuilds(
  config: LynxShipConfig,
  state: RemoteCliState,
): Promise<BuildJob[]> {
  const { organizationId, projectId } = await ensureRemoteTarget(config, state);
  return request<BuildJob[]>(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    `/v1/builds?organizationId=${encodeURIComponent(organizationId)}&projectId=${encodeURIComponent(projectId)}`,
  );
}

export async function cancelRemoteBuild(
  config: LynxShipConfig,
  id: string,
): Promise<BuildJob> {
  return request<BuildJob>(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    `/v1/builds/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function retryRemoteBuild(
  config: LynxShipConfig,
  id: string,
): Promise<BuildJob> {
  return request<BuildJob>(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    `/v1/builds/${encodeURIComponent(id)}/retry`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function waitForRemoteBuild(
  config: LynxShipConfig,
  id: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<BuildJob> {
  const timeoutMs = options.timeoutMs ?? 60 * 60 * 1_000;
  const pollMs = options.pollMs ?? 2_000;
  const startedAt = Date.now();
  for (;;) {
    const job = await getRemoteBuild(config, id);
    if (["success", "failed", "canceled", "timed_out"].includes(job.state))
      return job;
    if (Date.now() - startedAt >= timeoutMs)
      throw new Error(
        "Remote build " + id + " did not finish before the timeout",
      );
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export async function submitRealArtifact(
  config: LynxShipConfig,
  state: RemoteCliState,
  job: BuildJob,
  latest: boolean,
): Promise<unknown> {
  if (!job.artifact?.key || !job.artifact.url)
    throw new Error("The build artifact is not registered in Cloudflare R2");
  const { organizationId, projectId } = await ensureRemoteTarget(config, state);
  const filename = job.artifact.name;
  const artifactResponse = await request<{
    artifact: { hash: string; key: string; url: string };
  }>(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    "/v1/artifacts",
    {
      method: "POST",
      body: JSON.stringify({
        projectId,
        organizationId,
        filename,
        artifact: {
          key: job.artifact.key,
          hash: job.artifact.hash,
          size: job.artifact.size,
          contentType: job.artifact.contentType,
          url: job.artifact.url,
          expiresAt: job.artifact.expiresAt,
        },
      }),
    },
  );
  return request(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    "/v1/submissions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId,
        organizationId,
        platform: job.platform,
        artifact: { hash: artifactResponse.artifact.hash },
        artifactKey: artifactResponse.artifact.key,
        downloadUrl: artifactResponse.artifact.url,
        downloadExpiresAt: job.artifact.expiresAt,
        latest,
        buildId: latest ? null : job.id,
        idempotencyKey: `cli:${job.id}:${job.artifact.hash}`,
      }),
    },
  );
}

export async function publishOtaRelease(
  config: LynxShipConfig,
  state: RemoteCliState,
  input: OtaPublishRequest,
): Promise<unknown> {
  const target = await ensureRemoteTarget(config, state);
  return request(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    "/v1/ota/releases",
    {
      method: "POST",
      body: JSON.stringify({ ...input, ...target }),
    },
  );
}

export async function rollbackOtaRelease(
  config: LynxShipConfig,
  state: RemoteCliState,
  input: OtaRollbackRequest,
): Promise<unknown> {
  const target = await ensureRemoteTarget(config, state);
  return request(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    "/v1/ota/rollback",
    {
      method: "POST",
      body: JSON.stringify({ ...input, ...target }),
    },
  );
}

export async function fetchOtaPublicKey(
  config: LynxShipConfig,
): Promise<{ keyId: string; publicKey: string }> {
  return request(
    {
      apiUrl: config.cli?.apiUrl,
      token: config.cli?.token ?? process.env.LYNXSHIP_TOKEN,
    },
    "/v1/ota/public-key",
  );
}
