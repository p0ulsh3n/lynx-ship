# @lynxship/media

Capability-based media API contracts for Lynx hosts. Android and iOS
system-picker bridges are included; the iOS library path uses
`PHPickerViewController`, while camera capture uses `UIImagePickerController`.
A HarmonyOS source bridge is staged for the preview Autolink workflow and
uses the official `PhotoViewPicker` and `CameraPicker` APIs, but current
released Lynx SDK documentation does not yet make HarmonyOS Native Modules a
generally available production target. Web and Desktop hosts must provide
explicit adapters. Permission declarations, privacy strings, lifecycle, and
resource release remain platform-host responsibilities.

The included Android, iOS and HarmonyOS bridges support photo/video selection,
camera capture, and an explicit microphone recording lifecycle. Use
`await client.startRecording()` followed by `await client.stopRecording()`;
the latter returns an app-scoped URI. A recording must be started in the
foreground after microphone consent. The native adapters stop and release the
recorder on failure/interruption and remove incomplete files.

The public media client also has Sparkling-compatible transfer operations:
`uploadFile`, `uploadImage`, `downloadFile`, and `saveDataURL`. They require an
explicit host transfer adapter/native implementation, validate HTTPS endpoints,
reject URL credentials and header injection, bound payloads/timeouts, and only
accept app-scoped local file URIs. This keeps network and filesystem effects in
the host while giving every Lynx project one typed API.

For the unified picker flow, use `chooseMedia`:

```ts
const result = await client.chooseMedia({
  mediaTypes: ["image", "video"],
  sourceType: "album",
  maxCount: 3,
  needBase64Data: false,
});
```

The request supports the official Sparkling-style camera/album, camera-facing,
multi-selection, image compression and base64 options. Android and iOS bridges
now implement the album/camera flow and return app-private files with metadata;
HarmonyOS exposes the older picker methods while its `chooseMedia` parity is
still gated on a DevEco device validation. Inputs and every native result are
validated and bounded before they cross the JavaScript/native boundary. The
older `pick`/`capture` methods remain available for compatibility and are not
silently used when they cannot preserve the requested options.

`saveToPhotoAlbum` is handled by the Android bridge on Android 10+ through the
scoped `MediaStore` API and by the iOS bridge through the Photos add-only
authorization flow. Both wait for the platform operation and return a typed
failure if it cannot be completed; applications can then provide an explicit
host adapter for another platform policy.

Microphone recording still requires the host application to declare its
platform privacy permission: `RECORD_AUDIO` on Android,
`NSMicrophoneUsageDescription` on iOS, and `ohos.permission.MICROPHONE` on
HarmonyOS. A library cannot invent the host's user-facing privacy purpose
string, so the iOS key remains an explicit host-app configuration.

Pure Lynx applications can use `@lynxship/media/lynx` to resolve the Autolinked
`LynxShipMedia` module. System pickers return scoped URIs; the application must
consume or copy them according to its upload/storage policy.

This package does not implement video calling or a WebSocket transport; those concerns belong to separate application/backend layers. The HarmonyOS
bridge must be built with a current DevEco/Harmony SDK; it cannot be validated
by the Windows Android build.

## Official sources checked on 2026-08-29

- [HarmonyOS Media Library Kit and picker privacy](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V13/photoaccesshelper-overview-V13)
- [HarmonyOS CameraPicker guidance](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-camera-58)
- [HarmonyOS PhotoViewPicker API](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-picker)
- [Apple PHPickerViewController](https://developer.apple.com/documentation/photosui/phpickerviewcontroller)
- [Apple AVAudioRecorder](https://developer.apple.com/documentation/avfaudio/avaudiorecorder)
- [Apple AVAudioApplication microphone permission](https://developer.apple.com/documentation/avfaudio/avaudioapplication/requestrecordpermission%28completionhandler%3A%29)
- [Apple audio interruptions](https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions)
- [HarmonyOS AVRecorder](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-apis-media-t)
- [HarmonyOS microphone permission](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V13/permission-guidelines-V13)
