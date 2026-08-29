import test from "node:test";
import assert from "node:assert/strict";
import { tokensToCss, validateTokens } from "@lynxship/ui-tokens";

test("validates and deterministically emits design tokens", () => {
  const tokens = { color: { primary: "#00d4aa" }, radius: { md: 12 } } as const;
  assert.equal(validateTokens(tokens).valid, true);
  assert.equal(
    tokensToCss(tokens),
    ":root {\n  --color-primary: #00d4aa;\n  --radius-md: 12;\n}",
  );
});

test("rejects unsafe values, duplicate output names, and circular groups", () => {
  assert.equal(
    validateTokens({
      color: { primary: "red" },
      "color-primary": "blue",
    }).valid,
    false,
  );
  assert.equal(
    validateTokens({ color: "red; color: blue" }).issues[0]?.code,
    "INVALID_VALUE",
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(validateTokens(circular as never).valid, false);
  assert.throws(() => tokensToCss({ color: "red" }, ".app{}"));
});
