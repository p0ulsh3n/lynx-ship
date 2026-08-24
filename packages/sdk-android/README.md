# Android SDK

Status: Beta native source. `LynxShipOtaClient.java` is a dependency-light
client for an Android Lynx host. It checks `/v1/ota/check`, verifies the
Ed25519 manifest and SHA-256 assets, downloads into a temporary directory,
commits the candidate atomically, and rolls back after repeated failed
launches.

The application must embed the public signing key, provide the embedded bundle
fallback, and call `beginLaunch()` before rendering. Render
`openActiveAsset("main.lynx.bundle")` through the host's
`AbsTemplateProvider`. Call `markLaunchSuccess()` only after the Lynx view has
successfully loaded. Native code is never downloaded by this client.

The source intentionally does not depend on an AndroidX networking or JSON
stack. The host application supplies its endpoint, project, channel, runtime
fingerprint and public key map. Production endpoints must use HTTPS; HTTP is
accepted only for localhost emulator development.

For a local Android project, prefer including this directory as an Android
library module:

```groovy
include ":lynxship-sdk-android"
project(":lynxship-sdk-android").projectDir = file("<path-to>/packages/sdk-android")
dependencies {
    implementation project(":lynxship-sdk-android")
}
```

For a small host that deliberately compiles the source directly, add the
source directory to the app module:

```groovy
sourceSets {
    main.java.srcDirs += file("../../packages/sdk-android/src/main/java")
}
```
