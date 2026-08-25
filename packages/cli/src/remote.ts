import type { BuildJob, Platform } from "@lynxship/contracts";
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
  const body = (await response.json()) as T & {
    message?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      `LynxShip API ${response.status}: ${body.message ?? body.error ?? response.statusText}`,
    );
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
