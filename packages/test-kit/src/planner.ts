import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  LynxTestPlan,
  LynxTestProject,
  TestKind,
  TestPlatform,
} from "./contracts.js";
import { TEST_KINDS, TEST_PLATFORMS } from "./contracts.js";

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function packageManager(
  manifest: PackageJson,
): LynxTestProject["packageManager"] {
  const value = manifest.packageManager?.split("@")[0];
  if (
    value === "npm" ||
    value === "pnpm" ||
    value === "yarn" ||
    value === "bun"
  )
    return value;
  return "unknown";
}

export async function readLynxTestProject(
  root: string,
): Promise<LynxTestProject> {
  const raw = await readFile(join(root, "package.json"), "utf8");
  const manifest = JSON.parse(raw) as PackageJson;
  return {
    root,
    packageManager: packageManager(manifest),
    scripts: manifest.scripts ?? {},
    dependencies: { ...manifest.dependencies, ...manifest.devDependencies },
  };
}

function scriptStep(
  project: LynxTestProject,
  id: string,
  kind: TestKind,
  script: string,
  reason: string,
  platform?: TestPlatform,
) {
  const command =
    project.packageManager === "unknown" ? "npm" : project.packageManager;
  const args = ["run", script];
  return { id, kind, platform, command, args, reason };
}

export function createLynxTestPlan(
  project: LynxTestProject,
  options: {
    kinds?: readonly TestKind[];
    platforms?: readonly TestPlatform[];
  } = {},
): LynxTestPlan {
  const kinds = options.kinds ?? TEST_KINDS;
  const platforms = options.platforms ?? TEST_PLATFORMS;
  const steps = [] as ReturnType<typeof scriptStep>[];
  const warnings: string[] = [];
  const add = (
    kind: TestKind,
    script: string,
    reason: string,
    platform?: TestPlatform,
  ) => {
    if (kinds.includes(kind) && project.scripts[script])
      steps.push(
        scriptStep(
          project,
          `${kind}${platform ? `-${platform}` : ""}`,
          kind,
          script,
          reason,
          platform,
        ),
      );
  };
  add("unit", "test", "Run the project's declared unit test command.");
  add(
    "bundle",
    "build",
    "Build the Lynx bundle using the project's declared bundler.",
  );
  if (!project.dependencies["@lynx-js/testing-environment"])
    warnings.push(
      "@lynx-js/testing-environment is not declared; native/runtime checks must be supplied by the host project.",
    );
  for (const platform of platforms) {
    const script = `test:${platform}`;
    add(
      "native-smoke",
      script,
      `Run the project's declared ${platform} smoke test.`,
      platform,
    );
    add(
      "runtime",
      `runtime:${platform}`,
      `Run the project's declared ${platform} runtime test.`,
      platform,
    );
  }
  return { project, steps, warnings };
}
