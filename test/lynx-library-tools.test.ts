import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodegenCommand,
  createLibraryScaffoldCommand,
  createLibraryWorkflowPlan,
  inspectLynxLibrary,
  runLibraryWorkflow,
  runLibraryScaffold,
  validateLynxLibrary,
} from "@lynxship/lynx-library-tools";

test("validates official Lynx library platform paths and codegen plans", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  await mkdir(join(root, "android"));
  await mkdir(join(root, "ios"));
  await writeFile(
    join(root, "ios", "Library.podspec"),
    "Pod::Spec.new { |s| s.name = 'Library' }\n",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@example/library",
      scripts: { codegen: "lynx-autolink-codegen" },
    }),
  );
  await writeFile(
    join(root, "lynx.lib.json"),
    JSON.stringify({
      platforms: {
        android: { packageName: "com.example.library", sourceDir: "android" },
        ios: { sourceDir: "ios", podspecPath: "ios/Library.podspec" },
      },
    }),
  );
  const result = await validateLynxLibrary(root);
  assert.deepEqual(result.platforms, ["android", "ios"]);
  assert.equal(result.packageJson?.name, "@example/library");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(createCodegenCommand(root), {
    executable: "lynx-autolink-codegen",
    args: [],
    cwd: root,
  });
});

test("creates an official Lynx library scaffold command without escaping the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  const command = createLibraryScaffoldCommand({
    root,
    directory: "packages/button",
    packageName: "@example/lynx-button",
    features: ["native-module", "element", "native-module"],
    platforms: ["android", "ios", "harmony", "lynxtron"],
    packageManager: "pnpm",
    androidPackage: "com.example.button",
    moduleName: "ButtonModule",
    elementName: "XButton",
  });
  assert.deepEqual(command, {
    executable: "pnpm",
    args: [
      "create",
      "lynx-library",
      "--",
      "--dir",
      "packages/button",
      "--features",
      "native-module,element",
      "--platforms",
      "android,ios,harmony,lynxtron",
      "--package-name",
      "@example/lynx-button",
      "--android-package",
      "com.example.button",
      "--module-name",
      "ButtonModule",
      "--element-name",
      "XButton",
    ],
    cwd: root,
  });
  const result = await runLibraryScaffold(command, async () => ({
    code: 0,
    stdout: "scaffolded",
    stderr: "",
  }));
  assert.equal(result.stdout, "scaffolded");
  assert.throws(
    () =>
      createLibraryScaffoldCommand({
        root,
        directory: "../outside",
        packageName: "@example/lynx-button",
        features: ["element"],
        platforms: ["android"],
      }),
    /inside the workspace root/,
  );
});

test("rejects native paths that escape a Lynx library", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@example/library",
      scripts: { codegen: "codegen" },
    }),
  );
  await writeFile(
    join(root, "lynx.lib.json"),
    JSON.stringify({
      platforms: { android: { packageName: "x", sourceDir: "../outside" } },
    }),
  );
  const inspection = await inspectLynxLibrary(root);
  assert.equal(inspection.issues[0]?.code, "path-invalid");
  await assert.rejects(validateLynxLibrary(root), {
    name: "LynxLibraryValidationError",
  });
});

test("rejects an incomplete HarmonyOS source HAR", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  await mkdir(join(root, "harmony"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@example/library",
      scripts: { codegen: "codegen" },
    }),
  );
  await writeFile(
    join(root, "lynx.lib.json"),
    JSON.stringify({ platforms: { harmony: { packageDir: "harmony" } } }),
  );
  const inspection = await inspectLynxLibrary(root);
  assert.equal(inspection.issues[0]?.code, "harmony-package-missing");
});

test("requires package metadata and the official codegen script", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  await writeFile(
    join(root, "lynx.lib.json"),
    JSON.stringify({ platforms: {} }),
  );
  const inspection = await inspectLynxLibrary(root);
  assert.equal(inspection.issues[0]?.code, "package-missing");
});

test("accepts official shared native source targets for macOS and Windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  await mkdir(join(root, "shared"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@example/library",
      scripts: { codegen: "codegen" },
    }),
  );
  await writeFile(
    join(root, "lynx.lib.json"),
    JSON.stringify({
      platforms: {
        macos: { sourceDir: "shared" },
        windows: { sourceDir: "shared" },
      },
    }),
  );
  const inspection = await validateLynxLibrary(root);
  assert.deepEqual(inspection.platforms, ["macos", "windows"]);
});

test("resolves the official Lynxtron artifact root and rejects unknown platforms", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  await mkdir(join(root, "dist"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@example/library",
      scripts: { codegen: "codegen" },
    }),
  );
  await writeFile(
    join(root, "lynx.lib.json"),
    JSON.stringify({
      platforms: {
        lynxtron: { path: "dist" },
        linux: { sourceDir: "linux" },
      },
    }),
  );
  const inspection = await inspectLynxLibrary(root);
  assert.deepEqual(inspection.platforms, ["lynxtron"]);
  assert.equal(inspection.sourceStats.lynxtron?.size, 0);
  assert.equal(inspection.issues[0]?.code, "platform-invalid");
});

test("plans and runs codegen, build, test, smoke and dry-run pack in order", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  const plan = createLibraryWorkflowPlan({
    root,
    packageManager: "pnpm",
    scripts: { codegen: "codegen", build: "build", test: "test" },
    example: { root: "example", packageManager: "pnpm", script: "build" },
  });
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["codegen", "build", "test", "smoke", "pack"],
  );
  assert.deepEqual(plan.steps.at(-1)?.command.args, ["pack", "--dry-run"]);
  const executed: string[] = [];
  const results = await runLibraryWorkflow(plan, async (executable, args) => {
    executed.push(`${executable} ${args.join(" ")}`);
    return { code: 0, stdout: "ok", stderr: "" };
  });
  assert.equal(results.length, 5);
  assert.equal(executed[0], "pnpm run codegen");
  assert.equal(executed.at(-1), "pnpm pack --dry-run");
});

test("stops the library workflow at the first failed step", async () => {
  const root = await mkdtemp(join(tmpdir(), "lynx-library-tools-"));
  const plan = createLibraryWorkflowPlan({
    root,
    packageManager: "npm",
    scripts: { codegen: "codegen", build: "build", test: "test" },
  });
  const executed: string[] = [];
  await assert.rejects(
    runLibraryWorkflow(plan, async (_executable, args) => {
      executed.push(args[1] ?? args[0] ?? "");
      return {
        code: executed.length === 2 ? 1 : 0,
        stdout: "",
        stderr: "failed",
      };
    }),
    { name: "LynxLibraryWorkflowError" },
  );
  assert.deepEqual(executed, ["codegen", "build"]);
});
