import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TokenManager, type TokenRecord } from "@lynxship/auth";
import {
  JsonRepository,
  PostgresStateRepository,
  type StateRepository,
} from "@lynxship/db";
import { LeaseQueue, RedisQueue } from "@lynxship/queue";
import { FileStorage, S3ObjectStorage } from "@lynxship/storage";
import {
  OtaService,
  createSigningKey,
  type SigningKey,
} from "@lynxship/signing";
import {
  BuildService,
  LocalBuildExecutor,
  type BuildExecutor,
} from "@lynxship/build-orchestrator";
import { MockSubmissionProvider, SubmissionService } from "@lynxship/submit";
import { WorkerRegistry } from "@lynxship/worker-agent";
import {
  assert,
  type BuildJob,
  type Channel,
  type Membership,
  type Organization,
  type Project,
  type Release,
  type SubmissionJob,
  type Worker,
} from "@lynxship/contracts";
import type {
  UsageRecord,
  AuditEvent,
  TelemetryEvent,
  WebhookDelivery,
  WebhookEndpoint,
} from "./services.js";
import {
  AuditLog,
  DeviceRegistry,
  ManagedProviderCatalog,
  Metrics,
  SecretVault,
  type SecretRecord,
  TelemetryStore,
  TenantDirectory,
  UsageLedger,
  WebhookService,
} from "./services.js";
import { snapshotApp } from "./persistence.js";

export interface RuntimeBackends {
  database: "json" | "postgres";
  queue: "memory" | "redis";
  storage: "r2" | "filesystem" | "s3";
  state: StateRepository<PersistentAppState> & {
    close?: () => Promise<void>;
  };
  queueStore: RedisQueue | null;
  storageStore: FileStorage | S3ObjectStorage | null;
  probe: () => Promise<{
    database: boolean;
    queue: boolean;
    storage: boolean;
  }>;
  close: () => Promise<void>;
}

export interface LynxShipApp {
  auth: TokenManager;
  builds: BuildService;
  ota: OtaService;
  submissions: SubmissionService;
  workers: WorkerRegistry;
  usage: UsageLedger;
  queue: LeaseQueue<BuildJob>;
  vault: SecretVault;
  tenants: TenantDirectory;
  telemetry: TelemetryStore;
  webhooks: WebhookService;
  metrics: Metrics;
  audit: AuditLog;
  providers: ManagedProviderCatalog;
  devices: DeviceRegistry;
  runtime?: RuntimeBackends;
}

export function createApp(
  runtime?: RuntimeBackends,
  auth = new TokenManager(),
  buildExecutor?: BuildExecutor,
): LynxShipApp {
  return {
    auth,
    builds: new BuildService(
      buildExecutor ?? (runtime ? undefined : new LocalBuildExecutor()),
    ),
    ota: new OtaService(),
    // A local in-memory app is intentionally convenient for tests and demos.
    // Persistent/runtime-backed apps receive no implicit mock provider.
    submissions: new SubmissionService(
      runtime ? undefined : new MockSubmissionProvider(),
    ),
    workers: new WorkerRegistry(),
    usage: new UsageLedger(),
    queue: new LeaseQueue<BuildJob>(),
    vault: new SecretVault(
      process.env.NODE_ENV === "production"
        ? requiredEnv("LYNXSHIP_CREDENTIAL_MASTER_KEY")
        : (envValue("LYNXSHIP_CREDENTIAL_MASTER_KEY") ?? undefined),
    ),
    tenants: new TenantDirectory(),
    telemetry: new TelemetryStore(),
    webhooks: new WebhookService(),
    metrics: new Metrics(),
    audit: new AuditLog(),
    providers: new ManagedProviderCatalog(),
    devices: new DeviceRegistry(),
    runtime,
  };
}

export interface PersistentAppState {
  tokens: TokenRecord[];
  signingKey: SigningKey | null;
  builds: BuildJob[];
  releases: Release[];
  channels: Channel[];
  submissions: SubmissionJob[];
  submissionKeys: Array<[string, string]>;
  credentials: SecretRecord[];
  /** Compatibility field for local state and pre-vault migrations. */
  signingKeyCredentialId?: string | null;
  workers: Worker[];
  usage: UsageRecord[];
  organizations: Organization[];
  projects: Project[];
  memberships: Membership[];
  auditEvents: AuditEvent[];
  telemetryEvents: TelemetryEvent[];
  webhookEndpoints: WebhookEndpoint[];
  webhookDeliveries: WebhookDelivery[];
  metrics: Record<string, number>;
}

const emptyState: PersistentAppState = {
  tokens: [],
  signingKey: null,
  builds: [],
  releases: [],
  channels: [],
  submissions: [],
  submissionKeys: [],
  credentials: [],
  signingKeyCredentialId: null,
  workers: [],
  usage: [],
  organizations: [],
  projects: [],
  memberships: [],
  auditEvents: [],
  telemetryEvents: [],
  webhookEndpoints: [],
  webhookDeliveries: [],
  metrics: {},
};

export function envValue(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) return readFileSync(file, "utf8").trim();
  return process.env[name];
}

function requiredEnv(name: string): string {
  const value = envValue(name);
  assert(
    value,
    "RUNTIME_CONFIG",
    `${name} is required for the selected driver`,
  );
  return value;
}

async function createRuntime(root: string): Promise<RuntimeBackends> {
  const databaseDriver = process.env.LYNXSHIP_DATABASE_DRIVER ?? "json";
  const queueDriver = process.env.LYNXSHIP_QUEUE_DRIVER ?? "memory";
  const storageDriver =
    process.env.LYNXSHIP_STORAGE_DRIVER ??
    (process.env.NODE_ENV === "production" ? "r2" : "filesystem");

  assert(
    databaseDriver === "json" || databaseDriver === "postgres",
    "DATABASE_DRIVER",
    "LYNXSHIP_DATABASE_DRIVER must be json or postgres",
  );
  assert(
    queueDriver === "memory" || queueDriver === "redis",
    "QUEUE_DRIVER",
    "LYNXSHIP_QUEUE_DRIVER must be memory or redis",
  );
  assert(
    storageDriver === "r2" ||
      storageDriver === "filesystem" ||
      storageDriver === "s3",
    "STORAGE_DRIVER",
    "LYNXSHIP_STORAGE_DRIVER must be r2, filesystem or s3",
  );

  const state =
    databaseDriver === "postgres"
      ? new PostgresStateRepository<PersistentAppState>(
          requiredEnv("DATABASE_URL"),
          "control-plane",
          emptyState,
        )
      : new JsonRepository<PersistentAppState>(
          join(root, ".lynxship", "server-state.json"),
          emptyState,
        );

  if (databaseDriver === "postgres")
    await (state as PostgresStateRepository<PersistentAppState>).initialize();

  const queueStore =
    queueDriver === "redis" ? new RedisQueue(requiredEnv("REDIS_URL")) : null;
  if (queueStore) await queueStore.initialize();

  const storageStore =
    storageDriver === "r2"
      ? envValue("R2_ENDPOINT") &&
        envValue("R2_ACCESS_KEY_ID") &&
        envValue("R2_SECRET_ACCESS_KEY") &&
        envValue("R2_BUCKET")
        ? new S3ObjectStorage(
            envValue("R2_ENDPOINT")!,
            envValue("R2_ACCESS_KEY_ID")!,
            envValue("R2_SECRET_ACCESS_KEY")!,
            envValue("R2_BUCKET")!,
          )
        : null
      : storageDriver === "s3"
        ? new S3ObjectStorage(
            requiredEnv("S3_ENDPOINT"),
            requiredEnv("S3_ACCESS_KEY"),
            requiredEnv("S3_SECRET_KEY"),
            process.env.S3_BUCKET ?? "lynxship",
          )
        : new FileStorage(join(root, ".lynxship", "objects"));
  assert(
    process.env.NODE_ENV !== "production" ||
      (databaseDriver === "postgres" &&
        queueDriver === "redis" &&
        storageDriver === "r2" &&
        storageStore instanceof S3ObjectStorage),
    "PRODUCTION_CONFIG",
    "Production requires PostgreSQL, Redis and a configured R2 storage backend",
  );
  if (storageStore instanceof S3ObjectStorage) await storageStore.initialize();

  const probe = async () => {
    const checks = await Promise.allSettled([
      databaseDriver === "postgres"
        ? (state as PostgresStateRepository<PersistentAppState>).probe()
        : Promise.resolve(),
      queueStore?.probe() ?? Promise.resolve(),
      storageStore instanceof S3ObjectStorage
        ? storageStore.probe()
        : Promise.resolve(),
    ]);
    return {
      database: checks[0]?.status === "fulfilled",
      queue: checks[1]?.status === "fulfilled",
      storage:
        storageDriver === "r2"
          ? checks[2]?.status === "fulfilled" &&
            storageStore instanceof S3ObjectStorage
          : checks[2]?.status === "fulfilled",
    };
  };

  return {
    database: databaseDriver,
    queue: queueDriver,
    storage: storageDriver,
    state,
    queueStore,
    storageStore,
    probe,
    close: async () => {
      await queueStore?.close();
      if ("close" in state) await state.close?.();
      if (storageStore instanceof S3ObjectStorage)
        storageStore.client.destroy();
    },
  };
}

export async function loadPersistentApp(
  root: string,
  options: { buildExecutor?: BuildExecutor } = {},
): Promise<{
  app: LynxShipApp;
  save: () => Promise<PersistentAppState>;
  runtime: RuntimeBackends;
}> {
  const runtime = await createRuntime(root);
  const state = await runtime.state.read();
  const app = createApp(
    runtime,
    new TokenManager(state.tokens ?? []),
    options.buildExecutor,
  );

  app.vault.restore(state.credentials ?? []);
  let signingKey = state.signingKey;
  if (process.env.NODE_ENV === "production") {
    if (state.signingKeyCredentialId) {
      signingKey = JSON.parse(
        app.vault.read(state.signingKeyCredentialId),
      ) as SigningKey;
    }
    if (!signingKey) {
      signingKey = createSigningKey();
      const stored = app.vault.put({
        organizationId: "system",
        name: "ota-signing-key",
        type: "ota-signing-key",
        value: JSON.stringify(signingKey),
      });
      state.signingKeyCredentialId = stored.id;
    }
    // Never write the private signing key back into the durable state record.
    state.signingKey = null;
  } else {
    signingKey ??= createSigningKey();
    state.signingKey = signingKey;
  }

  app.builds.restore(state.builds ?? []);

  app.ota = new OtaService(signingKey);
  for (const release of state.releases ?? [])
    app.ota.releases.set(release.id, release);
  for (const channel of state.channels ?? [])
    app.ota.channels.set(`${channel.projectId}:${channel.name}`, channel);

  app.submissions.restore(state.submissions ?? [], state.submissionKeys ?? []);

  app.workers.restore(state.workers ?? []);
  app.usage.records = state.usage ?? [];

  for (const organization of state.organizations ?? [])
    app.tenants.organizations.set(organization.id, organization);
  for (const project of state.projects ?? [])
    app.tenants.projects.set(project.id, project);
  for (const membership of state.memberships ?? [])
    app.tenants.memberships.set(
      `${membership.organizationId}:${membership.userId}`,
      membership,
    );

  app.audit.events = state.auditEvents ?? [];
  app.telemetry.events = state.telemetryEvents ?? [];
  for (const endpoint of state.webhookEndpoints ?? [])
    app.webhooks.endpoints.set(endpoint.id, endpoint);
  app.webhooks.deliveries = state.webhookDeliveries ?? [];
  app.metrics.values = new Map(Object.entries(state.metrics ?? {}));

  const save = () => runtime.state.write(snapshotApp(app, state));
  await save();
  return { app, save, runtime };
}
