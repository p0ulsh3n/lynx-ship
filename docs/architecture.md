# Architecture

LynxShip is a pnpm workspace. The control-plane boundaries are deliberately small:

The repository-wide rules for creating and maintaining packages are in
[`AGENTS.md`](../AGENTS.md). They are enforced by `pnpm check` and the CI
`pnpm verify` gate; this document explains the resulting architecture.

```text
Lynx project ──> Rspeedy bundle ──> native host or web/desktop adapter
                                      │
CLI ──HTTP/API──> API (Fastify)       │   optional runtime packages
                    │                 ├─ @lynxship/expo / SDKs / OTA
       auth / build-orchestrator       ├─ @lynxship/lynx-realtime
       submit / worker-agent / worker-service
                                      └─ @lynxship/notifications
                    │
       db / queue / storage / signing / build-providers
```

The framework runtime boundary is intentionally host-neutral:

```text
createFramework(platform, container, capabilities)
          │
          ├─ capability registry and compatibility checks
          ├─ bundle mount/update contract
          └─ lifecycle: resolving → verified → mounting → first-screen → interactive
                 │
                 └─ explicit Android/iOS/Harmony/web/desktop container adapter
```

`@lynxship/framework` does not create a fake LynxView, download an artifact, or
reach into a native SDK. The host adapter owns those effects and reports the
real first-screen promise. This keeps the framework usable by native Lynx hosts,
Expo modules, Lynxtron and future adapters without making the portable core
depend on a platform.

`packages/contracts` contains shared DTOs and public domain types only. The
dashboard is a React/Vite client of the `/v1` API; it does not contain server
logic. `@lynxship/lynx-realtime` and `@lynxship/notifications` are optional
application-side packages: they do not turn the control plane into the
developer's messaging, notification or user-data backend.

## Source layout

The source tree follows the same boundary as the runtime architecture:

```text
packages/cli/src/
├─ cli.ts                 command orchestration and lifecycle
├─ commands/              command metadata and (as extraction continues) handlers
│  ├─ build-execution.ts   build lifecycle and platform dispatch
│  ├─ doctor.ts            environment and toolchain diagnostics
│  ├─ ota.ts               signed OTA publication and rollback
│  ├─ submit.ts            store artifact submission
│  ├─ configuration.ts     storage, signing and native-host setup
│  ├─ help.ts              declarative command reference
│  ├─ project.ts           project detection and native-host preparation
│  ├─ development.ts       Rspeedy, autolink and DevTool commands
│  ├─ device.ts             Android/iOS/HarmonyOS artifact installation
│  └─ logs.ts               platform-native log streaming
├─ runtime/               project discovery, arguments and local state boundaries
├─ *-build.ts             platform build adapters
├─ ios/                   iOS build, simulator, asset and project helpers
│  ├─ types.ts             shared iOS build options
│  ├─ simulator.ts         Simulator discovery and artifact lookup
│  ├─ simulator-build.ts   local Simulator build and launch
│  ├─ production-build.ts  device archive, export and upload
│  ├─ project.ts           Xcode project and CocoaPods operations
│  └─ assets.ts            bundle output and AppIcon synchronization
├─ ios-toolchain/         iOS diagnostics types, probes and inspection
├─ android-toolchain/     Android diagnostics types, probes and inspection
├─ android/               Android build options and signing boundary
├─ secure-store/          credential schema and OS-backed storage backends
├─ *-host.ts              native host initialization
├─ *-toolchain.ts         platform diagnostics and toolchain checks
├─ guidance/              typed guidance contracts and command catalog
│  ├─ types.ts             guidance contracts
│  └─ catalog.ts           declarative error guidance data
├─ plugins/               plugin contracts, discovery and native operations
│  ├─ contracts.ts         public result and application contracts
│  ├─ discovery.ts         npm resolution, validation and inspection
│  ├─ validation.ts        capability, permission and manifest validation
│  └─ native-operations.ts permission checks and atomic native writes
├─ configure.ts           provider and signing configuration
├─ remote.ts / r2.ts      control-plane and artifact boundaries
└─ ui/                    terminal presentation only

packages/api/src/
├─ http-api.ts            Fastify route composition
├─ routes.ts              route context and stable registration boundary
├─ routes/                tenant-scoped v1 route families
│  ├─ resources.ts        organizations, projects and artifacts
│  ├─ builds.ts           build lifecycle and worker reports
│  ├─ ota.ts              release, rollback and update checks
│  ├─ submissions.ts      store submission records
│  ├─ workers.ts          worker registration and leases
│  └─ tokens.ts           scoped token lifecycle
├─ http-auth.ts           request authentication and tenant scope
├─ contracts.ts           HTTP input validation
├─ app.ts                 application/runtime composition
└─ services/              audit, credentials, devices, metrics, providers,
                          rate limits, telemetry, usage and webhooks

packages/worker-service/src/
├─ index.ts                 hosted-worker compatibility barrel
├─ contracts.ts             immutable work, reporter and executor contracts
├─ validation.ts            payload, tenant and platform validation
├─ reporter.ts              bounded HTTPS control-plane transport
└─ service.ts               heartbeat, dispatch and failure lifecycle

packages/notifications/src/
├─ client.ts              client-safe registration and catch-up primitives
├─ expo.ts / lynx.ts      framework adapters
├─ server.ts              stable server-side public barrel
├─ index.ts               client-safe public barrel
└─ server/
   ├─ core.ts             shared validation, IDs and protocol types
   ├─ token-store.ts      encrypted memory/PostgreSQL token stores
   ├─ payloads.ts         message/presence payload contracts and routing
   ├─ provider-types.ts   shared provider contracts and credentials
   ├─ provider-validation.ts payload limits and provider errors
   ├─ providers.ts        stable provider compatibility barrel
   ├─ providers/          FCM, APNs and Huawei implementations
   └─ service.ts          provider selection and fan-out service

packages/microhs/src/
├─ index.ts               stable public barrel
├─ toolchain.ts           compatibility barrel
├─ core.ts                host, cache and toolchain contracts
├─ manifest.ts            manifest validation and loading
└─ acquire.ts             download, signature verification and cache install

packages/create-app/src/
├─ index.ts               executable and public compatibility boundary
├─ create.ts              project orchestration
├─ model.ts               templates, options and version constants
├─ args.ts                pure CLI argument parsing
└─ scaffold.ts            package-manager commands and project metadata

packages/submit/src/
├─ index.ts               contract submission service
├─ real-providers.ts      stable compatibility barrel for real providers
└─ providers/
   ├─ types.ts            shared artifact and credential contracts
   ├─ http.ts             retrying JSON transport and provider errors
   ├─ google-play.ts      Google Play OAuth, upload and commit flow
   └─ app-store-connect.ts Apple Transporter upload flow

packages/sdk-android/src/main/java/com/lynxship/sdk/android/
├─ LynxShipOtaClient.java public Android OTA lifecycle and compatibility API
├─ OtaStateStore.java     atomic OTA activation-state persistence
├─ OtaFiles.java          bounded file and byte-stream operations
├─ OtaSecurity.java      HTTPS, path, manifest and Ed25519 verification
├─ OtaSerialization.java deterministic staged-release serialization
├─ LynxShipContainerView.java reusable native Lynx container
├─ LynxShipContainerAssetLoader.java injected bundle source
└─ LynxShipContainerListener.java lifecycle callbacks

packages/realtime/src/
├─ index.ts               public barrel
├─ client.ts              realtime connection lifecycle
├─ client/
│  ├─ core.ts             protocol types, validation and socket factory
│  ├─ protocol.ts         inbound envelope validation
│  └─ reconnect.ts        bounded retry policy and jitter calculation
├─ presence.ts            stable presence public barrel
├─ presence/
│  ├─ models.ts           presence contracts and options
│  ├─ core.ts             validation and protocol parsing
│  ├─ state-store.ts      TTL state and profile aggregation
│  ├─ notifier.ts         foreground activity throttling
│  └─ client.ts           realtime presence lifecycle
├─ receipts.ts            delivered/read receipts
├─ activity-stack.ts      bounded banner queue
└─ react-lynx-banners.tsx ReactLynx presentation adapter

packages/framework/src/
├─ index.ts                  public compatibility barrel
├─ framework.ts              lifecycle facade and dependency injection boundary
├─ config/                   unified app config contracts and pure validation
├─ contracts/platform.ts     platform identifiers and framework errors
├─ capabilities/registry.ts capability registration and compatibility checks
├─ container/contracts.ts    host container prepare/mount/update contract
├─ container/runtime.ts      serialized prepare/reload, props, events and viewport facade
├─ container/presentation.ts toolkit-neutral loading/error/retry UI state
├─ container/validation.ts   bundle and container input validation
├─ container/global-props.ts standard OS, layout, safe-area and lifecycle context
├─ lifecycle/machine.ts      pure lifecycle state machine
└─ lifecycle/async.ts        serialized operations and abort/timeout waiting

packages/navigation/src/
├─ index.ts          public compatibility barrel
├─ contracts.ts      adapter, target and event contracts
├─ policy.ts         URL normalization and allowlist validation
├─ controller.ts     injected-adapter navigation lifecycle
└─ errors.ts         typed public errors

packages/bridge/src/
├─ index.ts       public compatibility barrel
├─ contracts.ts   transport, method, response and event contracts
├─ validation.ts  method, event, options and payload validation
├─ client.ts      allowlisted invocation, retry and timeout lifecycle
├─ lynx.ts        Android/iOS Lynx transport and response decoding
├─ typed.ts       typed method and event facades
├─ method-package.ts reusable community method packages
└─ errors.ts      typed public errors

packages/performance/src/
├─ index.ts       public compatibility barrel
├─ contracts.ts   entries, sources, sinks and collector API
├─ validation.ts  entry and retention-limit validation
├─ collector.ts   bounded collection, marks, measures and flushing
└─ errors.ts      typed public errors
```

Entrypoint files are deliberately thin barrels or lifecycle adapters. New
features should be added to the narrowest domain module and exported through a
barrel only when they are part of the public contract; platform-specific code
must not be placed in the package entrypoint. This keeps imports tree-shakable,
prevents server-only dependencies from entering mobile bundles, and makes the
same domain boundaries visible to tests and maintainers.

The repository also runs `pnpm architecture:check`. It checks that public
barrels remain present, that the server notifications package reuses the
client-safe implementation, and that tracked implementation files do not grow
past their current responsibility-specific limits. The line limits are
guardrails, not a target; a future extraction should lower or remove the
corresponding baseline.

Several larger files are intentional and have explicit budgets: `guidance/catalog.ts`
is declarative command data, `realtime/src/client.ts` is one connection state
machine whose invariants depend on shared private state, the Android OTA class
is the stable compatibility façade while `OtaStateStore.java` owns its atomic
state persistence, `commands/doctor.ts` assembles the
cross-platform diagnostic report, and the notifications provider, payload and
token-store modules keep one cohesive provider contract, payload schema or
encrypted persistence boundary respectively. Their protocol, validation,
persistence and provider responsibilities are extracted into neighboring
modules; any further growth is caught by the architecture check.

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
pending messages can be reclaimed after a lease timeout. The worker service
validates each immutable envelope against the authoritative build record,
binds it to one organization and platform, delegates real stages to an
injected executor, and reports through an authenticated HTTPS client. It does
not invent lifecycle states, run arbitrary commands or provision machines.
Cloud execution, worker isolation and production backup procedures remain
separate acceptance gates.
