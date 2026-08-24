# iOS SDK

Status: Beta native source. Add this directory as a local Swift Package.
`Sources/LynxShipOtaClient.swift` is a small OTA
client for a native Lynx host. It checks `/v1/ota/check`, verifies the Ed25519
manifest and SHA-256 assets with CryptoKit, stages the candidate atomically and
rolls back after repeated failed launches.

The host must embed the public signing key, provide the embedded bundle
fallback, call `beginLaunch()` before rendering, expose
`openActiveAsset("main.lynx.bundle")` through its Lynx template provider, and
call `markLaunchSuccess()` only after Lynx has loaded successfully. Native
executables are never downloaded by this client.

Production endpoints must use HTTPS. HTTP is accepted only for localhost
development. The SDK does not bypass Apple's review or native binary update
rules.
