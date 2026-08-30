import { strict as assert } from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { detectLynxFramework } from "@lynxship/cli/frameworks";
import { resolveMisoBuildTarget } from "../packages/cli/src/bundle-build.js";

test("detects Octane Lynx projects from the official Rspeedy integration", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-octane-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      devDependencies: {
        "@octanejs/rspeedy-plugin": "workspace:*",
      },
    }),
  );
  await writeFile(
    join(root, "lynx.config.ts"),
    "import { pluginOctane } from '@octanejs/rspeedy-plugin';\n",
  );

  assert.deepEqual(await detectLynxFramework(root), {
    framework: "octane",
    label: "Octane",
    evidence: "Octane compiler/Rspeedy integration detected",
    buildSystem: "rspeedy",
    experimental: true,
  });
});

test("detects upstreamed Miso Native projects as Nix bundle projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-miso-"));
  await writeFile(
    join(root, "flake.nix"),
    'inputs.miso.url = "github:haskell-miso/miso";\n# mkLynxBundle\n',
  );
  await writeFile(join(root, "cabal.project"), "packages: miso-native\n");

  assert.deepEqual(await detectLynxFramework(root), {
    framework: "miso",
    label: "Miso (Haskell)",
    evidence: "Miso.Native/Haskell project detected",
    buildSystem: "miso-nix",
    experimental: true,
  });
});

test("detects Sparkling-style app.config projects as Rspeedy Lynx apps", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynxship-app-config-"));
  await writeFile(
    join(root, "app.config.ts"),
    "export default { lynxConfig: {}, platform: { android: {} } };\n",
  );

  assert.deepEqual(await detectLynxFramework(root), {
    framework: "vanilla",
    label: "Vanilla Lynx",
    evidence: "Rspeedy/Lynx project detected",
    buildSystem: "rspeedy",
    experimental: false,
  });
});

test("resolves current and legacy Miso flake bundle outputs", () => {
  assert.equal(
    resolveMisoBuildTarget(
      "packages = { default = bundle; inherit bundle; }; mkLynxBundle",
    ),
    ".#bundle",
  );
  assert.equal(
    resolveMisoBuildTarget("packages = { default = bundle; }; mkLynxBundle"),
    ".#bundle",
  );
  assert.equal(
    resolveMisoBuildTarget("packages = { default = mkLynxBundle {}; };"),
    ".",
  );
  assert.equal(
    resolveMisoBuildTarget(
      "packages = { bundle = mkLynxBundle {}; };",
      "bundle",
    ),
    ".#bundle",
  );
});
