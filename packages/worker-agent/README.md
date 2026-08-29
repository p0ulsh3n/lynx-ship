# @lynxship/worker-agent

Shared worker registry and Redis Streams runtime for platform build agents.

`RedisWorkerRuntime` implements an at-least-once loop with consumer-group
acknowledgements, periodic lease renewal for long-running handlers and recovery
of abandoned messages. It intentionally does not
execute project commands: Android and iOS workers must provide handlers inside
their own isolated Linux/macOS environments and must make result publication
idempotent by build ID.

The runtime is a control-plane building block. It is not a hosted worker fleet
and it does not turn the local `LocalBuildProvider` into a production build
provider.
