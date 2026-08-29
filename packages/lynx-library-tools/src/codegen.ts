import { resolve } from "node:path";
import type {
  CodegenCommand,
  CodegenRunner,
  CodegenRunResult,
} from "./contracts.js";

export function createCodegenCommand(
  root: string,
  executable = "lynx-autolink-codegen",
): CodegenCommand {
  return { executable, args: [], cwd: resolve(root) };
}

export async function runCodegen(
  command: CodegenCommand,
  runner: CodegenRunner,
): Promise<CodegenRunResult> {
  const result = await runner(command.executable, command.args, command.cwd);
  if (!Number.isInteger(result.code))
    throw new Error("Lynx Autolink codegen returned an invalid exit code");
  return result;
}
