import type { TokenSet } from "./contracts.js";
import { flattenTokens, validateTokens } from "./validate.js";

export function tokensToCss(tokens: TokenSet, selector = ":root"): string {
  if (
    !selector.trim() ||
    /[\u0000-\u001f;{}]/.test(selector) ||
    selector.includes("/*") ||
    selector.includes("*/")
  )
    throw new Error("Invalid CSS selector for token output.");
  const result = validateTokens(tokens);
  if (!result.valid)
    throw new Error(
      `Invalid tokens: ${result.issues.map((issue) => issue.path).join(", ")}`,
    );
  const declarations = Object.entries(flattenTokens(tokens))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `  --${name}: ${String(value)};`);
  return `${selector} {\n${declarations.join("\n")}\n}`;
}
