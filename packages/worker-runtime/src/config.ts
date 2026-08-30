import { assert, type Platform } from "@lynxship/contracts";

export interface HostedWorkerConfig {
  readonly apiUrl: string;
  readonly token: string;
  readonly workerId: string;
  readonly organizationId: string;
  readonly platform: Platform;
  readonly redisUrl: string;
  readonly queueName: string;
  readonly queuePrefix: string;
  readonly sourceWorkspaceRoot?: string;
  readonly allowInsecureLocalhost: boolean;
}

export type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

export function loadHostedWorkerConfig(
  environment: WorkerEnvironment = process.env,
): HostedWorkerConfig {
  const apiUrl = required(environment, "LYNXSHIP_API_URL");
  const token = required(environment, "LYNXSHIP_WORKER_TOKEN");
  const workerId = required(environment, "LYNXSHIP_WORKER_ID");
  const organizationId = required(
    environment,
    "LYNXSHIP_WORKER_ORGANIZATION_ID",
  );
  const redisUrl = required(environment, "REDIS_URL");
  const allowInsecureLocalhost =
    environment.LYNXSHIP_ALLOW_INSECURE_LOCALHOST === "1";
  const url = parseUrl(apiUrl);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  assert(
    url.protocol === "https:" || (allowInsecureLocalhost && local),
    "WORKER_ENDPOINT",
    "LYNXSHIP_API_URL must use HTTPS; HTTP is allowed only for explicit localhost development",
  );
  const platformValue = environment.LYNXSHIP_WORKER_PLATFORM;
  assert(
    platformValue === "android" ||
      platformValue === "ios" ||
      platformValue === "harmony" ||
      platformValue === "web" ||
      platformValue === "desktop",
    "WORKER_PLATFORM",
    "LYNXSHIP_WORKER_PLATFORM must be android, ios, harmony, web or desktop",
  );
  assert(
    /^[A-Za-z0-9._:-]+$/.test(workerId),
    "WORKER_ID",
    "LYNXSHIP_WORKER_ID contains unsupported characters",
  );
  assert(
    !url.search && !url.hash,
    "WORKER_ENDPOINT",
    "LYNXSHIP_API_URL must not contain query or fragment data",
  );
  return {
    apiUrl: url.toString().replace(/\/$/, ""),
    token,
    workerId,
    organizationId,
    platform: platformValue,
    redisUrl,
    queueName: environment.LYNXSHIP_QUEUE_NAME ?? "builds",
    queuePrefix: environment.LYNXSHIP_QUEUE_PREFIX ?? "lynxship",
    sourceWorkspaceRoot: environment.LYNXSHIP_WORKSPACE_ROOT,
    allowInsecureLocalhost,
  };
}

function required(environment: WorkerEnvironment, name: string): string {
  const value = environment[name];
  assert(value, "WORKER_CONFIG", `${name} is required for a hosted worker`);
  return value;
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error("LYNXSHIP_API_URL must be a valid URL");
  }
}
