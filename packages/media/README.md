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
- [Apple AVAudioApplication microphone permission](<https://developer.apple.com/documentation/avfaudio/avaudioapplication/requestrecordpermission(completionhandler:)>)
- [Apple audio interruptions](https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions)
- [HarmonyOS AVRecorder](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-apis-media-t)
- [HarmonyOS microphone permission](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V13/permission-guidelines-V13)
