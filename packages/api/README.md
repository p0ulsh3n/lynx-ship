# @lynxship/api

Internal Fastify control-plane API for LynxShip. It wires authentication,
tenant-scoped build/OTA/submission resources, worker leases, telemetry,
health/readiness endpoints and the hosted-worker queue contract to the
repository and provider packages.

This package is private and server-side. It does not run in a Lynx application.
Use `createApp()` for tests or `loadPersistentApp()` for the local/self-hosted
service. Production deployments must provide the configured persistence,
queue, artifact storage, token secrets and provider credentials; the package
does not create hosted infrastructure by itself. Hosted workers consume the
immutable build work item through `@lynxship/worker-service`.

The hosted build source flow is split into two authenticated operations:
`POST /v1/build-sources` accepts a canonical base64 source snapshot and returns
its content-addressed reference; `GET /v1/worker-builds/:id/source` serves that
reference only to the registered worker bound to the job's organization and
platform. The API validates the snapshot, rejects credential-like files and
returns the source with `cache-control: no-store`. The JSON transport is
currently bounded by the API body limit; production deployments should move
large uploads to presigned multipart storage before treating it as an EAS-scale
build service. A bound worker can upload its finished binary through
`POST /v1/worker-builds/:id/artifact` only after reporting
`uploading_artifacts`; the API hashes and stores the bytes content-addressably
and returns a short-lived R2 download URL when external object storage is in
use. With R2 configured, the CLI uses `POST /v1/build-sources/upload-plan`,
uploads directly to the short-lived signed PUT URL, then calls
`POST /v1/build-sources/complete`; installations without R2 retain the bounded
base64 fallback.
