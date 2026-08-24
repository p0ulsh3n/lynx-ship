import { join } from "node:path";
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
import { BuildService } from "@lynxship/build-orchestrator";
import { SubmissionService } from "@lynxship/submit";
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
  TelemetryStore,
  TenantDirectory,
  UsageLedger,
  WebhookService,
} from "./services.js";

export interface RuntimeBackends {
  database: "json" | "postgres";
  queue: "memory" | "redis";
  storage: "r2" | "filesystem" | "s3";
  state: StateRepository<PersistentAppState> & {
    close?: () => Promise<void>;
  };
  queueStore: RedisQueue | null;
  storageStore: FileStorage | S3ObjectStorage | null;
  close: () => Promise<void>;
}

export interface LynxShipApp {
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

export function createApp(runtime?: RuntimeBackends): LynxShipApp {
  return {
    builds: new BuildService(),
    ota: new OtaService(),
    submissions: new SubmissionService(),
    workers: new WorkerRegistry(),
    usage: new UsageLedger(),
    queue: new LeaseQueue<BuildJob>(),
    vault: new SecretVault(),
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
  signingKey: SigningKey | null;
  builds: BuildJob[];
  releases: Release[];
  channels: Channel[];
  submissions: SubmissionJob[];
  submissionKeys: Array<[string, string]>;
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
  signingKey: null,
  builds: [],
  releases: [],
  channels: [],
  submissions: [],
  submissionKeys: [],
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

function requiredEnv(name: string): string {
  const value = process.env[name];
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
  const storageDriver = process.env.LYNXSHIP_STORAGE_DRIVER ?? "r2";

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
      ? null
      : storageDriver === "s3"
        ? new S3ObjectStorage(
            requiredEnv("S3_ENDPOINT"),
            requiredEnv("S3_ACCESS_KEY"),
            requiredEnv("S3_SECRET_KEY"),
            process.env.S3_BUCKET ?? "lynxship",
          )
        : new FileStorage(join(root, ".lynxship", "objects"));
  if (storageStore instanceof S3ObjectStorage) await storageStore.initialize();

  return {
    database: databaseDriver,
    queue: queueDriver,
    storage: storageDriver,
    state,
    queueStore,
    storageStore,
    close: async () => {
      await queueStore?.close();
      if ("close" in state) await state.close?.();
      if (storageStore instanceof S3ObjectStorage)
        storageStore.client.destroy();
    },
  };
}

export async function loadPersistentApp(root: string): Promise<{
  app: LynxShipApp;
  save: () => Promise<PersistentAppState>;
  runtime: RuntimeBackends;
}> {
  const runtime = await createRuntime(root);
  const state = await runtime.state.read();
  state.signingKey ??= createSigningKey();
  const app = createApp(runtime);

  for (const job of state.builds ?? []) app.builds.jobs.set(job.id, job);

  app.ota = new OtaService(state.signingKey);
  for (const release of state.releases ?? [])
    app.ota.releases.set(release.id, release);
  for (const channel of state.channels ?? [])
    app.ota.channels.set(`${channel.projectId}:${channel.name}`, channel);

  for (const job of state.submissions ?? [])
    app.submissions.jobs.set(job.id, job);
  app.submissions.idempotency = new Map(state.submissionKeys ?? []);

  for (const worker of state.workers ?? [])
    app.workers.workers.set(worker.id, worker);
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

function snapshotApp(
  app: LynxShipApp,
  state: PersistentAppState,
): PersistentAppState {
  return {
    ...state,
    signingKey: app.ota.signingKey,
    builds: app.builds.list(),
    releases: [...app.ota.releases.values()],
    channels: [...app.ota.channels.values()],
    submissions: app.submissions.list(),
    submissionKeys: [...app.submissions.idempotency.entries()],
    workers: app.workers.list(),
    usage: app.usage.list(),
    organizations: [...app.tenants.organizations.values()],
    projects: [...app.tenants.projects.values()],
    memberships: [...app.tenants.memberships.values()],
    auditEvents: app.audit.events,
    telemetryEvents: app.telemetry.events,
    webhookEndpoints: [...app.webhooks.endpoints.values()],
    webhookDeliveries: app.webhooks.deliveries,
    metrics: app.metrics.snapshot(),
  };
}
