# @lynxship/build-providers

Private provider boundary for build execution. `BuildProvider` separates worker
acquisition, execution, release and cleanup; `LocalBuildProvider` is a
deterministic contract implementation for tests and local orchestration.

It is not a hosted build fleet. Android and iOS native execution belongs to the
restricted `worker-android` and `worker-ios` executors, which still require
appropriately provisioned Linux/Windows or macOS hosts.
