import type { LynxShipApp, PersistentAppState } from "./app.js";

/**
 * Create the durable representation of the in-memory control-plane state.
 *
 * Keeping this projection separate from runtime construction makes the
 * repository boundary explicit and keeps persistence changes independent from
 * driver selection and service wiring.
 */
export function snapshotApp(
  app: LynxShipApp,
  state: PersistentAppState,
): PersistentAppState {
  return {
    ...state,
    tokens: app.auth.snapshot(),
    signingKey:
      process.env.NODE_ENV === "production" ? null : app.ota.signingKey,
    builds: app.builds.list(),
    releases: [...app.ota.releases.values()],
    channels: [...app.ota.channels.values()],
    submissions: app.submissions.list(),
    submissionKeys: [...app.submissions.idempotency.entries()],
    credentials: app.vault.snapshot(),
    signingKeyCredentialId: state.signingKeyCredentialId ?? null,
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
