# Expo + LynxShip OTA fixture

This fixture is intentionally small: it documents the files an Expo app needs
when it embeds a Lynx bundle through `@lynxship/expo`. It is not a replacement
for an Expo-generated native project. Create a real app with the current Expo
tooling, install the package, then run `npx expo prebuild` before building the
native targets.

```bash
npx create-expo-app@latest lynxship-expo-demo
cd lynxship-expo-demo
npx expo install @lynxship/expo
npx expo prebuild
npx pod-install
npx expo run:android
# macOS only:
npx expo run:ios
```

Copy [`app.json`](./app.json) and [`App.tsx`](./App.tsx) into that project and
replace the example values. Build the Lynx project so the file at
`bundlePath` exists before running `npx expo prebuild`; `@lynxship/expo` then
copies the bundle and its adjacent Rspeedy assets into the generated Android
and iOS native projects. The public key may be shipped in the app; OTA signing
credentials must remain in LynxShip or CI secrets.

`onReady` is emitted by the native view after the bundle provider has supplied
the bundle. Android additionally tracks Lynx's official first-screen callback
for the launch-success/rollback signal. Native changes still require a new
binary; only compatible Lynx JavaScript and assets belong in OTA releases.

Official references:

- [Expo native view modules](https://docs.expo.dev/modules/native-view-tutorial/)
- [Expo config plugins](https://docs.expo.dev/config-plugins/plugins/)
- [Lynx integration with existing apps](https://lynxjs.org/3.8/guide/start/integrate-with-existing-apps.html)
