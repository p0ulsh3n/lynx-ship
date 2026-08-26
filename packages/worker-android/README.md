# Android worker

The Android native executor is not shipped yet. The worker contract is
available through `@lynxship/worker-agent`: a future Linux worker must consume
Redis Streams, verify the immutable source manifest, invoke the pinned
Rspeedy/JDK/Android SDK/Gradle toolchain, upload a content-addressed artifact,
and acknowledge the job only after the control-plane result is durable.

No fake build implementation is exposed. This package remains private until
the isolated executor and toolchain acceptance tests exist.
