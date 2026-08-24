# Lynx verification matrix

## Development

| Claim                | Minimum proof                                                                         | Does not prove                                   |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Rspeedy dev works    | `lynxship dev` starts and Lynx Explorer loads the QR URL                              | native host, signing, store packaging            |
| Bundle builds        | `lynxship build` or the project's pinned `rspeedy build` creates `dist/*.lynx.bundle` | Android/iOS runtime behavior                     |
| Native host compiles | real Gradle/Xcode compile for the target                                              | valid store signature unless signing is verified |
| Device works         | install/run plus runtime logs or DevTool session                                      | OTA rollout safety                               |

Use the official [Lynx Quick Start](https://lynxjs.org/guide/start/quick-start),
[Rspeedy CLI](https://lynxjs.org/4.0/rspeedy/cli.html), and
[DevTool](https://lynxjs.org/guide/devtool) workflows for development proof.

## Native and Autolink

For a native library, verify all of the following:

```text
lynxship autolink check --platform android
lynxship autolink check --platform ios
lynxship autolink codegen --library-dir <library>
native build on each declared platform
runtime smoke test of each exported capability
```

Read [Autolink](https://lynxjs.org/guide/autolink) and the generated files for
the exact release. A manifest-only check does not prove native compilation or
runtime registration.

## OTA

Before publishing an update:

1. run `lynxship ota doctor --platform <platform>`;
2. compare the runtime fingerprint with a successful compatible binary;
3. verify the bundle/assets hashes and signature;
4. confirm the immutable artifact URL and channel policy;
5. test rollback on a non-production channel;
6. state explicitly when a native change requires a new binary.

An OTA rollback changes the release pointer; it does not remove R2 bytes or
reverse native code already installed on a device.
