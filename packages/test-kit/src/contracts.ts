export const TEST_PLATFORMS = [
  "android",
  "ios",
  "harmony",
  "web",
  "desktop",
] as const;

export const TEST_KINDS = [
  "unit",
  "bundle",
  "native-smoke",
  "runtime",
] as const;

export type TestPlatform = (typeof TEST_PLATFORMS)[number];

export type TestKind = (typeof TEST_KINDS)[number];

export interface LynxTestProject {
  root: string;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  scripts: Readonly<Record<string, string>>;
  dependencies: Readonly<Record<string, string>>;
}

export interface LynxTestStep {
  id: string;
  kind: TestKind;
  platform?: TestPlatform;
  command: string;
  args: readonly string[];
  reason: string;
}

export interface LynxTestPlan {
  project: LynxTestProject;
  steps: readonly LynxTestStep[];
  warnings: readonly string[];
}

export interface TestRunResult {
  step: LynxTestStep;
  exitCode: number;
  output?: string;
}

export type TestRunner = (step: LynxTestStep) => Promise<TestRunResult>;

export class LynxTestKitError extends Error {
  public readonly code = "LYNX_TEST_STEP_FAILED";

  public readonly result: TestRunResult;

  public constructor(result: TestRunResult) {
    super(
      `Test step ${result.step.id} failed with exit code ${result.exitCode}.`,
    );
    this.name = "LynxTestKitError";
    this.result = result;
  }
}
