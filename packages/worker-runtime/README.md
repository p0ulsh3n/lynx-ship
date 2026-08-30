# @lynxship/worker-runtime

Private hosted-worker bootstrap. It composes a Redis Streams queue with the
authenticated control-plane loader, source snapshot verifier/workspace, HTTPS
reporter and bound binary artifact uploader. It is a process boundary, not a
permission to execute arbitrary project commands.

The `lynxship-worker` entrypoint requires an explicit trusted
`LYNXSHIP_WORKER_EXECUTOR_MODULE`. Platform executors are deployed separately
inside isolated Linux, macOS or other approved hosts; the runtime refuses to
start without one. Required environment variables are:

```text
LYNXSHIP_API_URL=https://control.example.test
LYNXSHIP_WORKER_TOKEN=secret-worker-token
LYNXSHIP_WORKER_ID=worker-id
LYNXSHIP_WORKER_ORGANIZATION_ID=organization-id
LYNXSHIP_WORKER_PLATFORM=android|ios|harmony|web|desktop
REDIS_URL=redis://redis:6379
LYNXSHIP_WORKER_EXECUTOR_MODULE=/opt/worker/executor.mjs
```

`LYNXSHIP_ALLOW_INSECURE_LOCALHOST=1` is allowed only for local development.
The token is sent in an authorization header; it is never put in a URL. The
runtime closes Redis on SIGTERM/SIGINT and the worker service acknowledges a
queue message only after the executor and lease checks succeed.

An executor can use `context.sourceWorkspace` as its project root and
`context.uploadArtifact(bytes, contentType)` to return the signed output. The
control plane verifies the worker binding and computes the artifact digest; the
executor must still perform the platform-specific build and signing steps.

This package does not claim that a fleet, signing credentials, sandbox, image
registry, backup policy or capacity plan exists. Those are deployment gates and
must be provisioned and tested before a hosted service is advertised.
