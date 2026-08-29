import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LynxLibraryIssue } from "./contracts.js";

export function isValidPackageName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.startsWith("@")) {
    const [scope, name, ...extra] = value.split("/");
    return (
      extra.length === 0 &&
      /^@[a-z0-9][a-z0-9._~-]*$/.test(scope ?? "") &&
      /^[a-z0-9][a-z0-9._~-]*$/.test(name ?? "")
    );
  }
  return /^[a-z0-9][a-z0-9._~-]*$/.test(value);
}

function issue(
  code: LynxLibraryIssue["code"],
  message: string,
  path?: string,
): LynxLibraryIssue {
  return { code, message, ...(path ? { path } : {}) };
}

function parseObject(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function inspectPackageJson(root: string): Promise<{
  packageJson: Record<string, unknown> | null;
  issues: LynxLibraryIssue[];
}> {
  const path = resolve(root, "package.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return {
      packageJson: null,
      issues: [issue("package-missing", "package.json is missing", path)],
    };
  }
  const packageJson = parseObject(text);
  if (!packageJson)
    return {
      packageJson: null,
      issues: [
        issue(
          "package-invalid-json",
          "package.json must contain a JSON object",
          path,
        ),
      ],
    };
  const issues: LynxLibraryIssue[] = [];
  if (!isValidPackageName(packageJson.name))
    issues.push(
      issue(
        "package-name-missing",
        "package.json.name must be a valid lowercase npm package name",
        path,
      ),
    );
  const scripts = packageJson.scripts;
  const codegen =
    scripts && typeof scripts === "object" && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>).codegen
      : undefined;
  if (typeof codegen !== "string" || !codegen.trim())
    issues.push(
      issue(
        "codegen-script-missing",
        "package.json.scripts.codegen must invoke the library code generator",
        path,
      ),
    );
  return { packageJson, issues };
}
