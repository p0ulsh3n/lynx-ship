# Architecture

LynxShip is a pnpm workspace. The control-plane boundaries are deliberately small:

```text
CLI ──HTTP/API──> API (Fastify)
                    │
       auth / build-orchestrator / submit / worker-agent
                    │
       db / queue / storage / signing / build-providers
```

`packages/contracts` contains shared DTOs and public domain types only. The dashboard is a React/Vite client of the `/v1` API; it does not contain server logic.

The runtime selects one adapter per boundary:

```text
local development     JSON repository   memory queue   filesystem objects
Docker self-host       PostgreSQL        Redis          Cloudflare R2
cloud target           managed database  durable queue  Cloudflare R2
```

The Docker profile sets `LYNXSHIP_DATABASE_DRIVER=postgres`,
`LYNXSHIP_QUEUE_DRIVER=redis` and `LYNXSHIP_STORAGE_DRIVER=r2`. The CLI
validates the configured Cloudflare R2 bucket, uploads signed artifacts
directly to R2, and sends only immutable artifact metadata plus a temporary
download URL to the API. The API persists control-plane state in PostgreSQL
and queues build IDs in Redis Streams. Consumer groups provide at-least-once
delivery; workers acknowledge completed messages atomically and abandoned
pending messages can be reclaimed after a lease timeout. Cloud execution,
worker isolation and production backup procedures remain separate acceptance
gates.
