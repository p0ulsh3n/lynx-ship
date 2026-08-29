# @lynxship/api

Internal Fastify control-plane API for LynxShip. It wires authentication,
tenant-scoped build/OTA/submission resources, worker leases, telemetry and
health/readiness endpoints to the repository and provider packages.

This package is private and server-side. It does not run in a Lynx application.
Use `createApp()` for tests or `loadPersistentApp()` for the local/self-hosted
service. Production deployments must provide the configured persistence,
queue, artifact storage, token secrets and provider credentials; the package
does not create hosted infrastructure by itself.
