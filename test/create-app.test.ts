import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  addLynxShipCliDependency,
  createLynxShipConfig,
  detectPackageManager,
  LYNXSHIP_CLI_VERSION,
  parseArguments,
  RSPEEDY_VERSION,
} from "../packages/create-app/src/index.js";

test("create app defaults to the official TypeScript Rspeedy template", () => {
  const options = parseArguments(["demo"]);

  assert.equal(options.projectName, "demo");
  assert.equal(options.template, "react-ts");
  assert.equal(options.install, true);
  assert.equal(options.git, true);
});

test("create app parses explicit directory and no-install options", () => {
  const options = parseArguments([
    "--dir",
    "S:/apps/demo",
    "--template",
    "react-js",
    "--no-install",
    "--no-git",
  ]);

  assert.equal(options.directory, "S:/apps/demo");
  assert.equal(options.template, "react-js");
  assert.equal(options.install, false);
  assert.equal(options.git, false);
});

test("create app rejects unsupported templates and ambiguous targets", () => {
  assert.throws(() => parseArguments(["demo", "other"]), /Only one project/);
  assert.throws(
    () => parseArguments(["--template", "vanilla", "demo"]),
    /Unsupported template/,
  );
  assert.throws(
    () => parseArguments(["demo", "--dir", "other"]),
    /either a project name or --dir/,
  );
});

test("create app detects the invoking package manager", () => {
  assert.equal(
    detectPackageManager({ npm_config_user_agent: "pnpm/11" }),
    "pnpm",
  );
  assert.equal(
    detectPackageManager({ npm_config_user_agent: "yarn/4" }),
    "yarn",
  );
  assert.equal(detectPackageManager({ npm_config_user_agent: "bun/1" }), "bun");
  assert.equal(
    detectPackageManager({ npm_config_user_agent: "npm/11" }),
    "npm",
  );
});

test("create app uses the current stable Lynx/Rspeedy template", () => {
  const config = JSON.parse(createLynxShipConfig()) as {
    projectId: string;
    build: { production: { environment: string } };
  };

  assert.match(
    config.projectId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(config.build.production.environment, "production");
  assert.equal(RSPEEDY_VERSION, "latest");
});

test("create app installs the CLI locally in the generated project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "create-lynxship-app-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "demo",
        devDependencies: { typescript: "latest" },
      }),
    );

    await addLynxShipCliDependency(directory);

    const packageJson = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { devDependencies: Record<string, string> };
    assert.equal(packageJson.devDependencies["@lynxship/cli"], "latest");
    assert.equal(LYNXSHIP_CLI_VERSION, "latest");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
