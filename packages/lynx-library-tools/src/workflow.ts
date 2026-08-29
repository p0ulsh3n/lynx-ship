import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  CodegenCommand,
  LibraryWorkflowKind,
  LibraryWorkflowPlan,
  LibraryWorkflowProject,
  LibraryWorkflowRunResult,
  LibraryWorkflowRunner,
  LibraryWorkflowStep,
} from "./contracts.js";
import { LynxLibraryWorkflowError } from "./contracts.js";

function inside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith(".." + sep) && !isAbsolute(path));
}

function scriptCommand(
  packageManager: LibraryWorkflowProject["packageManager"],
  script: string,
  cwd: string,
): CodegenCommand {
  return {
    executable: packageManager,
    args: ["run", script],
    cwd: resolve(cwd),
  };
}

function addScript(
  steps: LibraryWorkflowStep[],
  warnings: string[],
  project: LibraryWorkflowProject,
  kind: Exclude<LibraryWorkflowKind, "pack" | "smoke">,
  script: string,
  reason: string,
): void {
  const value = project.scripts[script];
  if (typeof value !== "string" || !value.trim()) {
    warnings.push(`Library workflow script '${script}' is not declared.`);
    return;
  }
  steps.push({
    id: kind,
    kind,
    command: scriptCommand(project.packageManager, script, project.root),
    reason,
  });
}

export function createLibraryWorkflowPlan(
  project: LibraryWorkflowProject,
): LibraryWorkflowPlan {
  const root = resolve(project.root);
  const normalizedProject = { ...project, root };
  const steps: LibraryWorkflowStep[] = [];
  const warnings: string[] = [];

  addScript(
    steps,
    warnings,
    normalizedProject,
    "codegen",
    "codegen",
    "Generate the native specs and JavaScript facade with Lynx Autolink.",
  );
  addScript(
    steps,
    warnings,
    normalizedProject,
    "build",
    "build",
    "Build the library and its generated native sources.",
  );
  addScript(
    steps,
    warnings,
    normalizedProject,
    "test",
    "test",
    "Run the library's declared unit and contract tests.",
  );

  if (project.example) {
    const exampleRoot = resolve(root, project.example.root);
    if (!inside(root, exampleRoot) || exampleRoot === root)
      throw new Error("Library example must stay inside the library root.");
    if (!project.example.script.trim())
      throw new Error("Library example script must not be empty.");
    steps.push({
      id: "smoke",
      kind: "smoke",
      command: scriptCommand(
        project.example.packageManager,
        project.example.script,
        exampleRoot,
      ),
      reason:
        "Run the consumer example smoke test with the real project runner.",
    });
  } else {
    warnings.push("No library example was supplied for the smoke-test step.");
  }

  steps.push({
    id: "pack",
    kind: "pack",
    command: {
      executable: project.packageManager,
      args: ["pack", "--dry-run"],
      cwd: root,
    },
    reason:
      "Verify the publish file set without creating or uploading an archive.",
  });
  return { project: normalizedProject, steps, warnings };
}

export async function runLibraryWorkflow(
  plan: LibraryWorkflowPlan,
  runner: LibraryWorkflowRunner,
): Promise<readonly LibraryWorkflowRunResult[]> {
  const results: LibraryWorkflowRunResult[] = [];
  for (const step of plan.steps) {
    const result = await runner(
      step.command.executable,
      step.command.args,
      step.command.cwd,
    );
    if (!Number.isInteger(result.code))
      throw new Error(
        `Library workflow step ${step.id} returned an invalid exit code`,
      );
    const completed = { step, result };
    results.push(completed);
    if (result.code !== 0) throw new LynxLibraryWorkflowError(completed);
  }
  return results;
}
