import test from "node:test";
import assert from "node:assert/strict";
import {
  createLynxTestPlan,
  runLynxTestPlan,
  type LynxTestProject,
} from "@lynxship/test-kit";

const project: LynxTestProject = {
  root: "/tmp/project",
  packageManager: "pnpm",
  scripts: {
    test: "vitest",
    build: "rspeedy build",
    "test:android": "detox test",
  },
  dependencies: {},
};

test("plans only declared commands and warns about missing official runtime environment", () => {
  const plan = createLynxTestPlan(project, {
    kinds: ["unit", "bundle", "native-smoke"],
    platforms: ["android", "ios"],
  });
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["unit", "bundle", "native-smoke-android"],
  );
  assert.equal(plan.warnings.length, 1);
});

test("runs in order and stops on a failed real runner result", async () => {
  const plan = createLynxTestPlan(project, { kinds: ["unit", "bundle"] });
  const seen: string[] = [];
  const results = await runLynxTestPlan(plan, async (step) => {
    seen.push(step.id);
    return { step, exitCode: 0 };
  });
  assert.deepEqual(seen, ["unit", "bundle"]);
  assert.equal(results.length, 2);
});
