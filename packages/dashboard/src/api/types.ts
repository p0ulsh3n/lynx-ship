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

export interface Build {
  id: string;
  projectId: string;
  organizationId: string;
  platform: "android" | "ios";
  profile: string;
  state: BuildState;
  attempts: number;
  createdAt?: string;
  artifact?: { name: string; hash: string };
  transitions?: Array<{ state: BuildState; at: string; reason?: string }>;
}

export interface Submission {
  id: string;
  projectId: string;
  organizationId: string;
  platform: "android" | "ios";
  status: string;
  remoteId?: string;
  createdAt: string;
}

export interface Release {
  id: string;
  manifest: {
    projectId: string;
    channel: string;
    platform: "android" | "ios";
    runtimeVersion: string;
    sequence: number;
  };
  message: string;
  rollout: number;
  paused: boolean;
  createdAt: string;
}

export interface HealthResponse {
  status: string;
}

export interface Worker {
  id: string;
  name: string;
  organizationId: string;
  platform: "android" | "ios";
  status: string;
  lastHeartbeatAt: string;
}
