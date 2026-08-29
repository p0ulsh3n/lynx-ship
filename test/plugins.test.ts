import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyProjectPlugins,
  inspectProjectPlugins,
} from "../packages/cli/src/plugins.js";
import { validateConfig } from "../packages/cli/src/config.js";
import {
  defineLynxShipPlugin,
  LYNXSHIP_PLUGIN_API_VERSION,
} from "@lynxship/plugin-api";

test("plugin-api validates a public plugin definition", () => {
  const plugin = defineLynxShipPlugin({
    apiVersion: LYNXSHIP_PLUGIN_API_VERSION,
    name: "@example/plugin-api-fixture",
    capabilities: ["config"],
    permissions: ["config:write"],
    apply: () => ({ config: { enabled: true } }),
  });
  assert.equal(plugin.name, "@example/plugin-api-fixture");
});

async function writePlugin(
  root: string,
  name: string,
  capabilities: string[],
  permissions: string[],
  body: string,
): Promise<void> {
  const packageRoot = join(root, "node_modules", name);
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      lynxship: {
        apiVersion: 1,
        plugin: "./dist/plugin.js",
        capabilities,
        permissions,
      },
    }),
  );
  await writeFile(join(packageRoot, "dist", "plugin.js"), body);
}

test("project plugins are discovered from npm metadata and applied idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-plugin-"));
  await mkdir(join(root, "node_modules", "@example", "native-plugin", "dist"), {
    recursive: true,
  });
  await mkdir(join(root, "android"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"plugin-fixture"}\n');
  await writeFile(
    join(root, "lynxship.json"),
    JSON.stringify(
      validateConfig({
        projectId: "plugin-fixture",
        plugins: [["@example/native-plugin", { marker: "fixture" }]],
      }),
    ),
  );
  await writeFile(
    join(root, "node_modules", "@example", "native-plugin", "package.json"),
    JSON.stringify({
      name: "@example/native-plugin",
      version: "1.0.0",
      type: "module",
      lynxship: {
        apiVersion: 1,
        plugin: "./dist/plugin.js",
        capabilities: ["native", "config"],
        permissions: ["native:write", "config:write"],
      },
    }),
  );
  await writeFile(
    join(
      root,
      "node_modules",
      "@example",
      "native-plugin",
      "dist",
      "plugin.js",
    ),
    [
      "export default {",
      "  apiVersion: 1,",
      '  name: "@example/native-plugin",',
      '  capabilities: ["native", "config"],',
      '  permissions: ["native:write", "config:write"],',
      "  apply(context) {",
      "    return {",
      "      config: { build: { production: { environment: context.options.marker } } },",
      "      native: [{",
      '        platform: "android",',
      '        file: "android/settings.gradle",',
      '        operation: "ensure-text",',
      '        text: "plugin-fixture-enabled",',
      "      }],",
      "    };",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  const config = validateConfig({
    projectId: "plugin-fixture",
    plugins: [["@example/native-plugin", { marker: "fixture" }]],
  });
  const report = await inspectProjectPlugins(root, config);
  assert.equal(report.configured, 1);
  assert.equal(report.plugins[0]?.status, "ready");
  await writeFile(join(root, "android", "settings.gradle"), "plugin-fixture\n");
  const first = await applyProjectPlugins(root, config, {
    platform: "android",
    profile: "production",
  });
  const second = await applyProjectPlugins(root, config, {
    platform: "android",
    profile: "production",
  });
  assert.deepEqual(first.applied, ["@example/native-plugin"]);
  assert.deepEqual(second.applied, ["@example/native-plugin"]);
  assert.equal(
    (first.config.build?.production as { environment?: string }).environment,
    "fixture",
  );
  assert.equal(
    await readFile(join(root, "android", "settings.gradle"), "utf8"),
    "plugin-fixture\nplugin-fixture-enabled\n",
  );
  assert.equal(first.changes.filter((change) => change.changed).length, 1);
  assert.equal(second.changes.filter((change) => change.changed).length, 0);
});

test("plugin native file paths cannot escape the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-plugin-path-"));
  await mkdir(join(root, "node_modules", "escape-plugin", "dist"), {
    recursive: true,
  });
  await writeFile(join(root, "package.json"), '{"name":"plugin-fixture"}\n');
  await writeFile(
    join(root, "node_modules", "escape-plugin", "package.json"),
    JSON.stringify({
      name: "escape-plugin",
      version: "1.0.0",
      type: "module",
      lynxship: {
        apiVersion: 1,
        plugin: "./dist/plugin.js",
        capabilities: ["native"],
        permissions: ["native:write"],
      },
    }),
  );
  await writeFile(
    join(root, "node_modules", "escape-plugin", "dist", "plugin.js"),
    [
      "export default {",
      "  apiVersion: 1,",
      '  name: "escape-plugin",',
      '  capabilities: ["native"],',
      '  permissions: ["native:write"],',
      "  apply() {",
      "    return { native: [{",
      '      platform: "android",',
      '      file: "../outside.txt",',
      '      operation: "append-text",',
      '      text: "blocked",',
      "    }] };",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await assert.rejects(
    applyProjectPlugins(
      root,
      validateConfig({ projectId: "path-fixture", plugins: ["escape-plugin"] }),
      { platform: "android", profile: "production" },
    ),
    /escapes the project/,
  );
});

test("plugin dry-run is non-mutating and reports deterministic changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-plugin-plan-"));
  await writeFile(join(root, "package.json"), '{"name":"plugin-plan"}\n');
  await writePlugin(
    root,
    "plan-plugin",
    ["native"],
    ["native:write"],
    [
      "export default {",
      "  apiVersion: 1,",
      '  name: "plan-plugin",',
      '  capabilities: ["native"],',
      '  permissions: ["native:write"],',
      "  apply() { return { native: [{",
      '    platform: "android", file: "android/generated.txt",',
      '    operation: "ensure-text", text: "generated",',
      "  }] }; },",
      "};",
      "",
    ].join("\n"),
  );
  const config = validateConfig({
    projectId: "plan-fixture",
    plugins: ["plan-plugin"],
  });
  const result = await applyProjectPlugins(root, config, {
    platform: "android",
    profile: "production",
    mode: "plan",
  });
  assert.equal(result.changes[0]?.changed, true);
  await assert.rejects(readFile(join(root, "android", "generated.txt")));
});

test("plugin native changes roll back when a later operation fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-plugin-rollback-"));
  await writeFile(join(root, "package.json"), '{"name":"plugin-rollback"}\n');
  await writePlugin(
    root,
    "rollback-plugin",
    ["native"],
    ["native:write"],
    [
      "export default {",
      "  apiVersion: 1,",
      '  name: "rollback-plugin",',
      '  capabilities: ["native"],',
      '  permissions: ["native:write"],',
      "  apply() { return { native: [",
      '    { platform: "android", file: "android/generated.txt", operation: "ensure-text", text: "generated" },',
      '    { platform: "android", file: "android/missing.gradle", operation: "replace-text", from: "not-present", to: "broken" },',
      "  ] }; },",
      "};",
      "",
    ].join("\n"),
  );
  await assert.rejects(
    applyProjectPlugins(
      root,
      validateConfig({
        projectId: "rollback-fixture",
        plugins: ["rollback-plugin"],
      }),
      { platform: "android", profile: "production" },
    ),
    /rolled back/,
  );
  await assert.rejects(readFile(join(root, "android", "generated.txt")));
});

test("plugin permissions and native conflicts are enforced before writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-plugin-policy-"));
  await writeFile(join(root, "package.json"), '{"name":"plugin-policy"}\n');
  await writePlugin(
    root,
    "unpermitted-plugin",
    ["native"],
    [],
    [
      "export default {",
      "  apiVersion: 1,",
      '  name: "unpermitted-plugin",',
      '  capabilities: ["native"], permissions: [],',
      '  apply() { return { native: [{ platform: "android", file: "android/x", operation: "append-text", text: "x" }] }; },',
      "};",
      "",
    ].join("\n"),
  );
  await assert.rejects(
    applyProjectPlugins(
      root,
      validateConfig({ projectId: "policy", plugins: ["unpermitted-plugin"] }),
      { platform: "android", profile: "production" },
    ),
    /without declaring permission/,
  );

  await writePlugin(
    root,
    "first-conflict",
    ["native"],
    ["native:write"],
    [
      'export default { apiVersion: 1, name: "first-conflict", capabilities: ["native"], permissions: ["native:write"],',
      'apply() { return { native: [{ platform: "android", file: "android/settings.gradle", operation: "replace-text", from: "PLACEHOLDER", to: "ONE" }] }; } };',
      "",
    ].join("\n"),
  );
  await writePlugin(
    root,
    "second-conflict",
    ["native"],
    ["native:write"],
    [
      'export default { apiVersion: 1, name: "second-conflict", capabilities: ["native"], permissions: ["native:write"],',
      'apply() { return { native: [{ platform: "android", file: "android/settings.gradle", operation: "replace-text", from: "PLACEHOLDER", to: "TWO" }] }; } };',
      "",
    ].join("\n"),
  );
  await mkdir(join(root, "android"), { recursive: true });
  await writeFile(join(root, "android", "settings.gradle"), "PLACEHOLDER\n");
  await assert.rejects(
    applyProjectPlugins(
      root,
      validateConfig({
        projectId: "conflict",
        plugins: ["first-conflict", "second-conflict"],
      }),
      { platform: "android", profile: "production", mode: "plan" },
    ),
    /Conflicting or duplicate/,
  );
  assert.equal(
    await readFile(join(root, "android", "settings.gradle"), "utf8"),
    "PLACEHOLDER\n",
  );
});
