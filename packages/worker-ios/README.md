# iOS worker

The iOS native executor is not shipped yet. The worker contract is available
through `@lynxship/worker-agent`: a future macOS worker must consume Redis
Streams, verify the immutable source manifest, invoke the pinned Xcode/
CocoaPods toolchain, isolate keychain/provisioning material, upload a
content-addressed artifact, and acknowledge the job only after the result is
durable.

Xcode is intentionally not Dockerized. No fake build implementation is
exposed until cleanup, signing isolation and simulator/device acceptance tests
exist.
