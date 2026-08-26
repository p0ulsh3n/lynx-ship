import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateLynxShipExpoConfig } from "../packages/expo/dist/config.js";

const root = join(import.meta.dirname, "..", "packages", "expo");
const fixture = join(import.meta.dirname, "..", "examples", "expo-lynx-ota");

test("Expo configuration defaults are deterministic and safe", () => {
  assert.deepEqual(validateLynxShipExpoConfig({}), {
    channel: "production",
    embeddedBundle: "main.lynx.bundle",
    lynxVersion: "auto",
  });
  assert.throws(
    () => validateLynxShipExpoConfig({ endpoint: "http://api.example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateLynxShipExpoConfig({
        publicKeys: { key: "not-a-public-key" },
      }),
    /PEM/,
  );
  assert.throws(
    () => validateLynxShipExpoConfig({ lynxVersion: "not-a-version" }),
    /semver/,
  );
});

test("Expo package contains both native autolink registrations", async () => {
  const moduleConfig = JSON.parse(
    await readFile(join(root, "expo-module.config.json"), "utf8"),
  ) as {
    platforms: string[];
    android: { modules: string[] };
    ios: { modules: string[] };
  };
  assert.deepEqual(moduleConfig.platforms, ["android", "ios"]);
  assert.deepEqual(moduleConfig.android.modules, [
    "com.lynxship.expo.LynxShipExpoModule",
  ]);
  assert.deepEqual(moduleConfig.ios.modules, ["LynxShipExpoModule"]);
  assert.match(
    await readFile(join(root, "app.plugin.cjs"), "utf8"),
    /LynxShipOta/,
  );
  assert.match(
    await readFile(join(root, "app.plugin.js"), "utf8"),
    /app\.plugin\.cjs/,
  );
  const androidBuild = await readFile(
    join(root, "android", "build.gradle"),
    "utf8",
  );
  assert.match(androidBuild, /latest\.release/);
  assert.match(androidBuild, /lynx-trace/);
  assert.doesNotMatch(androidBuild, /3\.8\.0/);
  assert.match(
    await readFile(join(root, "android", "consumer-rules.pro"), "utf8"),
    /CalledByNative/,
  );
});

test("Expo fixture keeps the native plugin and bundle contract visible", async () => {
  const appConfig = JSON.parse(
    await readFile(join(fixture, "app.json"), "utf8"),
  ) as { expo: { plugins: Array<string | [string, Record<string, unknown>]> } };
  const plugin = appConfig.expo.plugins.find(
    (entry): entry is [string, Record<string, unknown>] =>
      Array.isArray(entry) && entry[0] === "@lynxship/expo",
  );
  assert.ok(plugin);
  assert.equal(plugin[1].embeddedBundle, "main.lynx.bundle");
  assert.match(await readFile(join(fixture, "App.tsx"), "utf8"), /LynxView/);
});
