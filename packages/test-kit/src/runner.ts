import {
  LynxTestKitError,
  type TestRunResult,
  type TestRunner,
  type LynxTestPlan,
} from "./contracts.js";

export async function runLynxTestPlan(
  plan: LynxTestPlan,
  runner: TestRunner,
): Promise<readonly TestRunResult[]> {
  const results: TestRunResult[] = [];
  for (const step of plan.steps) {
    const result = await runner(step);
    results.push(result);
    if (result.exitCode !== 0) throw new LynxTestKitError(result);
  }
  return results;
}
