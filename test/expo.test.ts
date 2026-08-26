import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLynxShipExpoConfig } from "../packages/expo/dist/config.js";
import assetSync from "../packages/expo/asset-sync.cjs";

const root = join(import.meta.dirname, "..", "packages", "expo");
const fixture = join(import.meta.dirname, "..", "examples", "expo-lynx-ota");

test("Expo configuration defaults are deterministic and safe", () => {
  assert.deepEqual(validateLynxShipExpoConfig({}), {
    channel: "production",
    embeddedBundle: "main.lynx.bundle",
    bundlePath: "dist/main.lynx.bundle",
    syncBundle: true,
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
  assert.throws(
    () => validateLynxShipExpoConfig({ syncBundle: "yes" as never }),
    /syncBundle/,
  );
});

test("Expo package contains both native autolink registrations", async () => {
  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as {
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(packageJson.peerDependencies?.["expo-modules-core"], undefined);
  assert.equal(packageJson.devDependencies?.["expo-modules-core"], "57.0.13");
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
  assert.match(androidBuild, /group\s*=\s*["']com\.lynxship\.expo["']/);
  assert.match(androidBuild, /version\s*=\s*moduleVersion/);
  assert.match(androidBuild, /versionCode\s+1/);
  assert.match(androidBuild, /versionName\s+moduleVersion/);
  assert.match(androidBuild, /new JsonSlurper\(\)/);
  assert.match(androidBuild, /id\s+["']expo-module-gradle-plugin["']/);
  assert.match(androidBuild, /latest\.release/);
  assert.match(androidBuild, /lynx-trace/);
  assert.doesNotMatch(androidBuild, /3\.8\.0/);
  const androidView = await readFile(
    join(
      root,
      "android",
      "src",
      "main",
      "java",
      "com",
      "lynxship",
      "expo",
      "LynxShipExpoView.kt",
    ),
    "utf8",
  );
  assert.match(
    androidView,
    /expo\.modules\.kotlin\.viewevent\.EventDispatcher/,
  );
  assert.match(androidView, /activeSequence\(\)/);
  assert.match(androidView, /as\? Application/);
  assert.match(androidView, /LynxEnv\.inst\(\)\.init\(application,/);
  assert.doesNotMatch(
    androidView,
    /expo\.modules\.kotlin\.events\.EventDispatcher/,
  );
  const podspec = await readFile(join(root, "lynxship-expo.podspec"), "utf8");
  assert.match(podspec, /require ['"]json['"]/);
  assert.match(podspec, /s\.version\s*=\s*package_version/);
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

test("Expo bundle sync copies the full Rspeedy output and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-expo-assets-"));
  try {
    await writeFile(join(root, "dist-main.lynx.bundle"), "bundle-v1");
    await mkdir(join(root, "dist", "static"), { recursive: true });
    await writeFile(join(root, "dist", "main.lynx.bundle"), "bundle-v1");
    await writeFile(join(root, "dist", "static", "logo.png"), "asset-v1");
    await mkdir(join(root, "android", "app", "src", "main", "assets"), {
      recursive: true,
    });

    const plan = await assetSync.createBundlePlan(root, {});
    const first = await assetSync.syncBundleDirectory({
      projectRoot: root,
      plan,
      destinationRoot: join(root, "android", "app", "src", "main", "assets"),
      manifestPath: join(root, "android", ".lynxship-assets.json"),
      platform: "android",
    });
    const second = await assetSync.syncBundleDirectory({
      projectRoot: root,
      plan,
      destinationRoot: join(root, "android", "app", "src", "main", "assets"),
      manifestPath: join(root, "android", ".lynxship-assets.json"),
      platform: "android",
    });
    assert.equal(first.files.length, 2);
    assert.deepEqual(second.files, first.files);
    assert.equal(
      await readFile(
        join(
          root,
          "android",
          "app",
          "src",
          "main",
          "assets",
          "main.lynx.bundle",
        ),
        "utf8",
      ),
      "bundle-v1",
    );
    assert.equal(
      await readFile(
        join(
          root,
          "android",
          "app",
          "src",
          "main",
          "assets",
          "static",
          "logo.png",
        ),
        "utf8",
      ),
      "asset-v1",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Expo bundle sync never overwrites an unmanaged native asset", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-expo-conflict-"));
  try {
    await mkdir(join(root, "dist"), { recursive: true });
    await mkdir(join(root, "android", "app", "src", "main", "assets"), {
      recursive: true,
    });
    await writeFile(join(root, "dist", "main.lynx.bundle"), "bundle");
    await writeFile(
      join(root, "android", "app", "src", "main", "assets", "main.lynx.bundle"),
      "developer-owned",
    );
    const plan = await assetSync.createBundlePlan(root, {});
    await assert.rejects(
      assetSync.syncBundleDirectory({
        projectRoot: root,
        plan,
        destinationRoot: join(root, "android", "app", "src", "main", "assets"),
        manifestPath: join(root, "android", ".lynxship-assets.json"),
        platform: "android",
      }),
      /unmanaged android asset/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
