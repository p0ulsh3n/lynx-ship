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
});
