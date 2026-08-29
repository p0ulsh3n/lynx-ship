# @lynxship/worker-android

Internal Android build-worker runtime for LynxShip. It is intentionally not a
public mobile SDK: the control plane assigns an isolated workspace and the
worker executes only an allow-listed Gradle task through the project wrapper.

The runtime validates workspace boundaries, rejects shell metacharacters and
arbitrary Gradle tasks, requires the Android toolchain preflight, and hashes a
declared output artifact before returning it. Cloud queue authentication,
workspace provisioning, artifact upload and signing remain injected by the
worker service; this package never embeds credentials or a fake cloud backend.

The restricted Android executor is included in this package and is exercised by
the worker contract tests. It can be embedded in a provisioned worker service;
that service must consume Redis Streams, verify the immutable source manifest,
invoke the pinned Rspeedy/JDK/Android SDK/Gradle toolchain, upload a
content-addressed artifact, and acknowledge the job only after the
control-plane result is durable.

No fake build implementation is exposed. A hosted multi-tenant fleet, isolated
workspace provisioning and cloud capacity are deployment responsibilities, not
provided by this package.
