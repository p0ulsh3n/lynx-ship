import type {
  Build,
  HealthResponse,
  Release,
  Submission,
  Worker,
} from "./types";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      body.message ?? `Request failed with status ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  builds: () => request<Build[]>("/v1/builds"),
  submissions: () => request<Submission[]>("/v1/submissions"),
  releases: (projectId: string, channel = "production") =>
    request<Release[]>(
      `/v1/ota/releases?projectId=${encodeURIComponent(projectId)}&channel=${encodeURIComponent(channel)}`,
    ),
  workers: (organizationId: string) =>
    request<Worker[]>(
      `/v1/workers?organizationId=${encodeURIComponent(organizationId)}`,
    ),
};
