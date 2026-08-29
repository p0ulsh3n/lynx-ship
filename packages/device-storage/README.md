# @lynxship/device-storage

An async JSON storage facade for Lynx apps. Android and iOS native bridges
are included through the Lynx native-library contract; Web and Desktop hosts
provide their own adapter. A HarmonyOS source bridge is staged for the preview
Autolink workflow, but current released Lynx SDK documentation does not yet
make HarmonyOS Native Modules a generally available production target. The
Harmony bridge uses the official `Preferences` API and persists changes with
`flushSync()` when the host supports that path. The package does not claim
encryption: sensitive values must use an adapter backed by the platform
secure-storage facility, with a documented key policy.

Keys are bounded to 256 characters and cannot contain control characters. Values that cannot be represented as JSON are rejected before reaching the adapter.
