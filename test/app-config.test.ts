import { strict as assert } from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  findAppConfig,
  loadAppConfig,
  resolveAppConfigAssetPath,
} from "../packages/cli/src/app-config.js";

test("loads and normalizes a Sparkling-compatible TypeScript app config", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-app-config-load-"));
  await writeFile(
    join(root, "app.config.ts"),
    `export default {
      lynxConfig: { source: { entry: { main: './src/main.tsx' } } },
      appName: 'Example',
      appIcon: 'assets/icon.png',
      platform: { android: { packageName: 'com.example.app' } },
      paths: { android: 'native/assets' },
      plugin: [['@lynxship/navigation', { enabled: true }]],
      router: { main: { bundle: 'main.lynx.bundle', path: '/' } },
    };`,
  );

  const loaded = await loadAppConfig(root, { required: true });
  assert.ok(loaded);
  assert.equal(loaded.config.appName, "Example");
  assert.equal(loaded.config.platform?.android?.packageName, "com.example.app");
  assert.deepEqual(loaded.config.routes, [
    { name: "main", bundle: "main.lynx.bundle", path: "/" },
  ]);
  assert.deepEqual(loaded.config.plugins, [
    ["@lynxship/navigation", { enabled: true }],
  ]);
  assert.equal(
    resolveAppConfigAssetPath(
      root,
      loaded,
      "android",
      "android/app/src/main/assets",
    ),
    join(root, "native", "assets"),
  );
});

test("does not execute or treat an unrelated app.config as a Lynx config", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-app-config-ignore-"));
  await writeFile(
    join(root, "app.config.js"),
    "export default { name: 'Expo' };\n",
  );
  assert.equal(await loadAppConfig(root), undefined);
});

test("rejects ambiguous app configs and unsafe app-config paths", async () => {
  const ambiguous = await mkdtemp(
    join(tmpdir(), "lynxship-app-config-ambiguous-"),
  );
  await writeFile(join(ambiguous, "app.config.js"), "export default {};\n");
  await writeFile(join(ambiguous, "app.config.mjs"), "export default {};\n");
  assert.throws(() => findAppConfig(ambiguous), {
    code: "CLI_APP_CONFIG_AMBIGUOUS",
  });

  const unsafe = await mkdtemp(join(tmpdir(), "lynxship-app-config-unsafe-"));
  await writeFile(
    join(unsafe, "app.config.js"),
    "export default { lynxConfig: {}, paths: { android: '../outside' } };\n",
  );
  await assert.rejects(() => loadAppConfig(unsafe, { required: true }), {
    code: "CLI_APP_CONFIG_INVALID",
  });
});
