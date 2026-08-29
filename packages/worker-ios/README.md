# @lynxship/worker-ios

Internal macOS/iOS build-worker runtime for LynxShip. It is not a mobile SDK:
the control plane assigns an isolated workspace and the worker invokes only
`xcodebuild` with validated project, scheme, SDK and configuration arguments.

The runtime requires macOS, Xcode command-line tools and `xcrun`, keeps all
paths inside the assigned workspace, rejects arbitrary shell arguments, and
hashes a declared output artifact before returning it. Signing identities,
keychain access, queue authentication, artifact upload and workspace cleanup
are injected by the worker service and are never stored in this package.

The restricted iOS executor is included in this package and is exercised by
the worker contract tests. It can be embedded in a provisioned macOS worker;
that service must consume Redis Streams, verify the immutable source manifest,
invoke the pinned Xcode/CocoaPods toolchain, isolate keychain/provisioning
material, upload a content-addressed artifact, and acknowledge the job only
after the result is durable.

Xcode is intentionally not Dockerized. No fake build implementation is
exposed. Hosted macOS capacity, cleanup policy, signing isolation and
simulator/device acceptance remain deployment and acceptance gates.
