import test from "node:test";
import assert from "node:assert/strict";
import {
  createTailwindBuildPlan,
  validateTailwindConfig,
} from "@lynxship/tailwind-lynx";

test("requires declared content and official preset", () => {
  assert.equal(validateTailwindConfig({}).valid, false);
  const plan = createTailwindBuildPlan({
    configPath: "tailwind.config.ts",
    content: ["./src/**/*.{tsx,ts}"],
    presetPackage: "@lynx-js/tailwind-preset",
  });
  assert.deepEqual(plan.args, [
    "-c",
    "tailwind.config.ts",
    "-i",
    "./src/styles.css",
    "-o",
    "./dist/styles.css",
  ]);
});
