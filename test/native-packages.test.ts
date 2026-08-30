import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectLynxLibrary } from "@lynxship/lynx-library-tools";

const root = process.cwd();
const nativePackages = [
  ["device-storage", ["android", "ios", "harmony"]],
  ["permissions", ["android", "ios", "harmony"]],
  ["media", ["android", "ios", "harmony"]],
  ["notifications", ["android", "ios", "harmony"]],
  ["navigation", ["android", "ios"]],
  ["bridge", ["android", "ios"]],
] as const;

test("native package manifests and source roots are valid Autolink contracts", async () => {
  for (const [name, platforms] of nativePackages) {
    const packageRoot = join(root, "packages", name);
    const report = await inspectLynxLibrary(packageRoot);
    assert.equal(
      report.issues.length,
      0,
      `${name}: ${report.issues.map((issue) => issue.message).join("; ")}`,
    );
    for (const platform of platforms) await access(join(packageRoot, platform));
  }
});

test("native package tarballs exclude local build output roots", async () => {
  for (const name of [
    "device-storage",
    "expo",
    "media",
    "notifications",
    "permissions",
    "navigation",
    "bridge",
    "sdk-android",
  ]) {
    const manifest = JSON.parse(
      await readFile(join(root, "packages", name, "package.json"), "utf8"),
    ) as { files?: unknown[] };
    const files = (manifest.files ?? []).filter(
      (file): file is string => typeof file === "string",
    );
    for (const platform of ["android", "ios", "harmony"]) {
      assert.ok(
        !files.some(
          (file) =>
            file === platform ||
            file === `${platform}/*` ||
            file === `${platform}/**`,
        ),
        `${name} must not publish the broad ${platform} root`,
      );
    }
  }
});

test("Android native packages resolve the selected Lynx version", async () => {
  for (const name of [
    "device-storage",
    "permissions",
    "media",
    "notifications",
    "navigation",
    "bridge",
  ]) {
    const gradle = await readFile(
      join(root, "packages", name, "android", "build.gradle"),
      "utf8",
    );
    assert.doesNotMatch(
      gradle,
      /\\\$\{lynxVersion\}/,
      `${name} contains an escaped Lynx version interpolation`,
    );
  }
});

test("native navigation rejects credential-bearing and hostless HTTPS URLs", async () => {
  const android = await readFile(
    join(
      root,
      "packages/navigation/android/src/main/java/com/lynxship/navigation/LynxShipNavigationModule.java",
    ),
    "utf8",
  );
  const ios = await readFile(
    join(root, "packages/navigation/ios/LynxShipNavigationModule.m"),
    "utf8",
  );
  const iosPage = await readFile(
    join(
      root,
      "packages/navigation/ios/LynxShipNavigationPageViewController.swift",
    ),
    "utf8",
  );
  assert.match(android, /uri\.getUserInfo\(\) != null/);
  assert.match(android, /uri\.getHost\(\) == null/);
  assert.match(android, /isAllowedLynxURL/);
  assert.match(android, /isAllowedBrowserURL/);
  assert.match(android, /openInSystemBrowser/);
  assert.match(android, /create\(String url,/);
  assert.match(android, /LynxShipPageActivity/);
  assert.match(android, /hasLocalBundle/);
  assert.match(android, /updateChrome/);
  assert.match(android, /setBackPressHandling/);
  assert.match(ios, /url\.user != nil \|\| url\.password != nil/);
  assert.match(ios, /url\.host\.length == 0/);
  assert.match(ios, /allowedLynxURL/);
  assert.match(ios, /allowedBrowserURL/);
  assert.match(ios, /openInSystemBrowser/);
  assert.match(ios, /lynxShipCreateURL/);
  assert.match(ios, /openDefaultLynxPage/);
  assert.match(ios, /hasLocalBundle/);
  assert.match(iosPage, /LynxShipNavigationHost/);
  const iosNavigationProps = await readFile(
    join(root, "packages/navigation/ios/LynxShipNavigationGlobalProps.swift"),
    "utf8",
  );
  assert.match(iosNavigationProps, /item\.name\.count <= 128/);
  assert.match(iosNavigationProps, /value\.count <= 4096/);
  assert.match(iosNavigationProps, /containerID/);
  assert.match(iosNavigationProps, /isAppBackground/);
  assert.match(iosPage, /makeBarButton/);
  assert.match(iosPage, /UIImage\(systemName: icon\)/);
  assert.match(iosPage, /isSafeIconName/);
  assert.match(iosPage, /button\.isEnabled/);
  assert.match(iosPage, /isSafeBundle/);
  assert.match(iosPage, /lynxship:navigation-action/);
});

test("Android navigation package ships a non-exported full-page Lynx host", async () => {
  const manifest = await readFile(
    join(root, "packages/navigation/android/src/main/AndroidManifest.xml"),
    "utf8",
  );
  const activity = await readFile(
    join(
      root,
      "packages/navigation/android/src/main/java/com/lynxship/navigation/LynxShipPageActivity.java",
    ),
    "utf8",
  );
  assert.match(manifest, /android:exported="false"/);
  assert.match(activity, /implements LynxShipNavigationHost/);
  assert.match(activity, /MAX_BUNDLE_BYTES/);
  const androidNavigationProps = await readFile(
    join(
      root,
      "packages/navigation/android/src/main/java/com/lynxship/navigation/LynxShipNavigationGlobalProps.java",
    ),
    "utf8",
  );
  assert.match(androidNavigationProps, /MAX_QUERY_ITEMS/);
  assert.match(androidNavigationProps, /MAX_QUERY_KEY_LENGTH/);
  assert.match(androidNavigationProps, /MAX_QUERY_VALUE_LENGTH/);
  assert.match(androidNavigationProps, /containerID/);
  assert.match(androidNavigationProps, /isAppBackground/);
  assert.match(activity, /registerPredictiveBack/);
  assert.match(activity, /!backPressHandlingEnabled/);
  assert.match(activity, /unregisterPredictiveBack/);
  assert.match(activity, /OnBackInvokedCallback/);
  assert.match(activity, /applyLeadingAction/);
  assert.match(
    activity,
    /getIdentifier\(iconName, "drawable", getPackageName\(\)\)/,
  );
  assert.match(activity, /isSafeIconName/);
  assert.match(activity, /setEnabled\(action\.optBoolean\("enabled"/);
  assert.match(activity, /isSafeBundleName/);
  assert.match(activity, /registerPredictiveBack/);
  assert.match(activity, /OnBackInvokedCallback/);
  assert.match(activity, /lynxship:navigation-action/);
  assert.match(activity, /lynxship:navigation-back-press/);
  assert.match(activity, /onBackPressed/);
  assert.match(manifest, /enableOnBackInvokedCallback="true"/);
});

test("native bridge keeps request validation and host dispatch explicit", async () => {
  const android = await readFile(
    join(
      root,
      "packages/bridge/android/src/main/java/com/lynxship/bridge/LynxShipBridgeModule.java",
    ),
    "utf8",
  );
  const ios = await readFile(
    join(root, "packages/bridge/ios/LynxShipBridgeModule.m"),
    "utf8",
  );
  assert.match(android, /MAX_REQUEST_BYTES/);
  assert.match(android, /LynxShipBridgeHost/);
  assert.match(android, /SAFE_IDENTIFIER/);
  assert.match(android, /new JSONObject\(requestJson\)/);
  assert.match(ios, /LynxShipBridgeHost/);
  assert.match(ios, /NSJSONSerialization/);
  assert.match(ios, /LynxShipBridgeMaxRequestBytes/);
});

test("the Android example registers every bundled LynxShip native module", async () => {
  const source = await readFile(
    join(
      root,
      "examples/lynx-android-demo/android/app/src/main/java/com/lynxship/androiddemo/LynxShipApplication.java",
    ),
    "utf8",
  );
  for (const moduleName of [
    "LynxShipDeviceStorage",
    "LynxShipPermissions",
    "LynxShipMedia",
    "LynxShipNotifications",
    "LynxShipNavigation",
  ]) {
    assert.match(
      source,
      new RegExp(`registerModule\\(\\"${moduleName}\\"`),
      `${moduleName} is not registered in the Android example`,
    );
  }
});

test("Android permission bridge handles permanent denial and concurrent requests", async () => {
  const module = await readFile(
    join(
      root,
      "packages/permissions/android/src/main/java/com/lynxship/permissions/LynxShipPermissionsModule.java",
    ),
    "utf8",
  );
  const activity = await readFile(
    join(
      root,
      "packages/permissions/android/src/main/java/com/lynxship/permissions/LynxShipPermissionActivity.java",
    ),
    "utf8",
  );
  assert.match(module, /shouldShowRequestPermissionRationale/);
  assert.match(module, /requested\./);
  assert.match(activity, /private boolean completed/);
  assert.match(activity, /LynxShipPermissionContract\.sendResult/);
  assert.match(activity, /blocked/);
});

test("Android callback bridges keep request state scoped to module instances", async () => {
  const sourceFiles = [
    join(
      root,
      "packages/notifications/android/src/main/java/com/lynxship/notifications/LynxShipNotificationsModule.java",
    ),
    join(
      root,
      "packages/media/android/src/main/java/com/lynxship/media/LynxShipMediaModule.java",
    ),
    join(
      root,
      "packages/permissions/android/src/main/java/com/lynxship/permissions/LynxShipPermissionsModule.java",
    ),
  ];
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /static\s+(?:final\s+)?(?:Callback|AtomicReference|CopyOnWriteArrayList)/,
    );
    assert.match(source, /void\s+destroy\s*\(/);
  }
});

test("native OTA SDK package source trees are publishable", async () => {
  await access(
    join(
      root,
      "packages",
      "sdk-android",
      "src/main/java/com/lynxship/sdk/android/LynxShipOtaClient.java",
    ),
  );
  await access(
    join(root, "packages", "sdk-ios", "Sources/LynxShipOtaClient.swift"),
  );
  await access(
    join(
      root,
      "packages",
      "sdk-android",
      "src/main/java/com/lynxship/sdk/android/OtaStateStore.java",
    ),
  );
  await access(
    join(
      root,
      "packages",
      "sdk-android",
      "src/main/java/com/lynxship/sdk/android/OtaFiles.java",
    ),
  );
  await access(
    join(
      root,
      "packages",
      "sdk-android",
      "src/main/java/com/lynxship/sdk/android/LynxShipGlobalProps.java",
    ),
  );
  await access(
    join(
      root,
      "packages",
      "sdk-android",
      "src/main/java/com/lynxship/sdk/android/LynxShipContainerBuilderConfigurator.java",
    ),
  );
  const androidContainer = await readFile(
    join(
      root,
      "packages",
      "sdk-android",
      "src/main/java/com/lynxship/sdk/android/LynxShipContainerView.java",
    ),
    "utf8",
  );
  const iosContainer = await readFile(
    join(root, "packages", "sdk-ios", "Sources/LynxShipContainer.swift"),
    "utf8",
  );
  const androidConfigurator = await readFile(
    join(
      root,
      "packages/sdk-android/src/main/java/com/lynxship/sdk/android/LynxShipContainerBuilderConfigurator.java",
    ),
    "utf8",
  );
  const iosConfigurator = await readFile(
    join(
      root,
      "packages/sdk-ios/Sources/LynxShipContainerBuilderConfigurator.swift",
    ),
    "utf8",
  );
  const androidGlobalProps = await readFile(
    join(
      root,
      "packages",
      "sdk-android",
      "src/main/java/com/lynxship/sdk/android/LynxShipGlobalProps.java",
    ),
    "utf8",
  );
  const iosGlobalProps = await readFile(
    join(root, "packages/sdk-ios/Sources/LynxShipGlobalProps.swift"),
    "utf8",
  );
  for (const method of [
    "prepare",
    "load",
    "reload",
    "updateData",
    "updateGlobalProps",
    "updateGlobalPropsByIncrement",
    "sendGlobalEvent",
    "release",
  ])
    assert.match(androidContainer, new RegExp(`\\b${method}\\s*\\(`));
  assert.match(androidContainer, /markState\(processorName\)/);
  for (const method of [
    "prepare",
    "load",
    "reload",
    "updateData",
    "updateGlobalProps",
    "updateGlobalPropsByIncrement",
    "sendGlobalEvent",
    "release",
  ])
    assert.match(iosContainer, new RegExp(`\\b${method}\\s*\\(`));
  assert.match(iosContainer, /markState\(processorName\)/);
  assert.match(androidContainer, /onFirstScreen/);
  assert.match(androidContainer, /onUpdate/);
  assert.match(androidContainer, /onResourceFetchStart/);
  assert.match(androidContainer, /onEnterForeground\(\)/);
  assert.match(androidContainer, /onEnterBackground\(\)/);
  assert.match(androidContainer, /setAutoGlobalProps/);
  assert.match(androidContainer, /LynxShipGlobalProps\.create/);
  assert.match(androidGlobalProps, /queryItems/);
  assert.match(androidContainer, /LynxShipContainerUiProvider/);
  assert.match(androidContainer, /showLoadingUi/);
  assert.match(androidContainer, /showErrorUi/);
  assert.match(
    androidConfigurator,
    /interface LynxShipContainerBuilderConfigurator/,
  );
  assert.match(androidContainer, /builderConfigurator\.configure\(builder\)/);
  assert.match(iosContainer, /lynxViewDidFirstScreen/);
  assert.match(iosContainer, /containerDidUpdate/);
  const expoAndroid = await readFile(
    join(
      root,
      "packages/expo/android/src/main/java/com/lynxship/expo/LynxShipExpoView.kt",
    ),
    "utf8",
  );
  const expoIos = await readFile(
    join(root, "packages/expo/ios/LynxShipExpoView.swift"),
    "utf8",
  );
  assert.match(expoAndroid, /reason" to "data/);
  assert.match(expoIos, /reason": "data/);
  assert.match(iosContainer, /containerDidStartFetchingResource/);
  assert.match(iosContainer, /onEnterForeground\(\)/);
  assert.match(iosContainer, /onEnterBackground\(\)/);
  assert.match(iosContainer, /setAutoGlobalProps/);
  assert.match(iosContainer, /LynxShipGlobalProps\.create/);
  assert.match(iosGlobalProps, /queryItems/);
  assert.match(iosContainer, /LynxShipContainerUIProvider/);
  assert.match(iosContainer, /showLoadingUI/);
  assert.match(iosContainer, /showErrorUI/);
  assert.match(
    iosConfigurator,
    /protocol LynxShipContainerBuilderConfigurator/,
  );
  assert.match(
    iosContainer,
    /self\.builderConfigurator\?\.configure\(builder\)/,
  );
  assert.match(androidContainer, /getContainerId/);
  assert.match(iosContainer, /containerID/);
  assert.match(androidContainer, /isLoadSuccess/);
  assert.match(iosContainer, /isLoadSuccess/);
});
