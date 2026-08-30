# @lynxship/worker-service

Internal hosted-worker orchestration for LynxShip. It connects a Redis Streams
queue to a tenant-bound Android, iOS or other platform executor, an
authenticated control-plane reporter and a worker-only build loader.

The service does not invent build progress and does not execute arbitrary shell
commands. A platform adapter owns the real source staging, toolchain,
signing and artifact-upload effects and calls `context.report()` for each
verified lifecycle state, including the terminal state. If the adapter throws,
the service publishes a bounded failure report; if reporting fails, the Redis
message remains pending for at-least-once recovery.

`HttpWorkerReporter` requires HTTPS (except explicitly opted-in localhost
development), sends the token only in an authorization header, bounds timeout
and error text, and includes the worker identity on every report. The
`HttpWorkerBuildLoader` reads builds only through the worker-bound API route;
the service validates the immutable queue envelope against that authoritative
record before invoking any executor.

When a build contains a source reference, `HttpWorkerSourceLoader` retrieves
the content-addressed snapshot through the worker-only source route. The
service verifies its digest and manifest, materializes it in a private
disposable workspace, exposes that path as `context.sourceWorkspace` and
removes the workspace after the executor returns. Platform executors should
use that path as their project root and upload their artifact before returning;
the service never exposes a source workspace to another job. When used with
`@lynxship/worker-runtime`, the context also exposes
`uploadArtifact(content, contentType)`. The runtime sends those bytes through
the bound worker endpoint; the API stores them and returns artifact metadata
that the executor can attach to its terminal success report.

This package is the worker process boundary, not a hosted fleet by itself. A
deployment still needs isolated Linux/macOS hosts, toolchains, secret
provisioning, source/artifact stores, monitoring and capacity policy.
