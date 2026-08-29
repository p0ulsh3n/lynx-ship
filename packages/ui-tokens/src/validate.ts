import type {
  TokenIssue,
  TokenSet,
  TokenValue,
  TokenValidation,
} from "./contracts.js";

const MAX_TOKEN_DEPTH = 32;
const MAX_TOKEN_COUNT = 10_000;

export function validateTokens(tokens: TokenSet): TokenValidation {
  const issues: TokenIssue[] = [];
  const seen = new WeakSet<object>();
  const flattened = new Set<string>();
  let count = 0;
  const visit = (set: TokenSet, prefix: string, depth: number): void => {
    if (!set || typeof set !== "object" || Array.isArray(set)) {
      issues.push({
        path: prefix || "$",
        code: "INVALID_VALUE",
        message: "Token groups must be plain objects.",
      });
      return;
    }
    if (seen.has(set)) {
      issues.push({
        path: prefix || "$",
        code: "INVALID_VALUE",
        message: "Token groups cannot contain circular references.",
      });
      return;
    }
    if (depth > MAX_TOKEN_DEPTH) {
      issues.push({
        path: prefix || "$",
        code: "TOO_DEEP",
        message: `Token groups cannot exceed ${MAX_TOKEN_DEPTH} levels.`,
      });
      return;
    }
    seen.add(set);
    for (const [name, value] of Object.entries(set)) {
      count += 1;
      const path = prefix ? `${prefix}.${name}` : name;
      if (!name.trim())
        issues.push({
          path,
          code: "EMPTY_NAME",
          message: "Token names cannot be empty.",
        });
      if (!/^[a-zA-Z0-9_-]+$/.test(name))
        issues.push({
          path,
          code: "INVALID_NAME",
          message: "Token names may contain letters, numbers, '_' and '-'.",
        });
      const cssName = prefix ? `${prefix}-${name}` : name;
      if (typeof value === "object" && value !== null)
        visit(value, path, depth + 1);
      else if (value === "" || value === null)
        issues.push({
          path,
          code: "EMPTY_VALUE",
          message: "Token values cannot be empty.",
        });
      else if (
        (typeof value === "number" && !Number.isFinite(value)) ||
        (typeof value !== "string" && typeof value !== "number") ||
        (typeof value === "string" && /[\u0000-\u001f{};]/.test(value))
      )
        issues.push({
          path,
          code: "INVALID_VALUE",
          message: "Token values must be finite and safe CSS values.",
        });
      if (!(typeof value === "object" && value !== null)) {
        if (flattened.has(cssName))
          issues.push({
            path,
            code: "DUPLICATE_NAME",
            message: `Token name '${cssName}' is produced more than once.`,
          });
        flattened.add(cssName);
      }
      if (count > MAX_TOKEN_COUNT) {
        issues.push({
          path,
          code: "TOO_MANY_TOKENS",
          message: `Token sets cannot exceed ${MAX_TOKEN_COUNT} entries.`,
        });
        break;
      }
    }
    seen.delete(set);
  };
  visit(tokens, "", 0);
  return { valid: issues.length === 0, issues };
}

export function flattenTokens(
  tokens: TokenSet,
): Readonly<Record<string, TokenValue>> {
  const validation = validateTokens(tokens);
  if (!validation.valid)
    throw new Error(
      `Invalid tokens: ${validation.issues.map((issue) => issue.path).join(", ")}`,
    );
  const flattened: Record<string, TokenValue> = {};
  const seen = new WeakSet<object>();
  const visit = (set: TokenSet, prefix: string, depth: number): void => {
    if (!set || typeof set !== "object" || Array.isArray(set))
      throw new Error("Token groups must be plain objects.");
    if (seen.has(set)) throw new Error("Token groups cannot be circular.");
    if (depth > MAX_TOKEN_DEPTH)
      throw new Error(`Token groups cannot exceed ${MAX_TOKEN_DEPTH} levels.`);
    seen.add(set);
    for (const [name, value] of Object.entries(set)) {
      const key = prefix ? `${prefix}-${name}` : name;
      if (typeof value === "object" && value !== null)
        visit(value, key, depth + 1);
      else flattened[key] = value;
    }
    seen.delete(set);
  };
  visit(tokens, "", 0);
  return flattened;
}
