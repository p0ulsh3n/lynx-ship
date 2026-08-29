export const LYNX_LIBRARY_MANIFEST = "lynx.lib.json";

export const LYNX_LIBRARY_PLATFORMS = [
  "android",
  "ios",
  "harmony",
  "lynxtron",
  "macos",
  "windows",
] as const;

export type LynxLibraryPlatform = (typeof LYNX_LIBRARY_PLATFORMS)[number];

export interface LynxLibraryPlatformDefinition {
  packageName?: unknown;
  sourceDir?: unknown;
  podspecPath?: unknown;
  packageDir?: unknown;
  path?: unknown;
  [key: string]: unknown;
}

export interface LynxLibraryManifest {
  platforms?: Partial<
    Record<LynxLibraryPlatform, LynxLibraryPlatformDefinition>
  >;
  [key: string]: unknown;
}

export interface LynxLibraryIssue {
  code:
    | "package-missing"
    | "package-invalid-json"
    | "package-name-missing"
    | "codegen-script-missing"
    | "manifest-missing"
    | "manifest-invalid-json"
    | "manifest-invalid-shape"
    | "platform-invalid"
    | "path-invalid"
    | "path-missing"
    | "android-package-missing"
    | "ios-podspec-missing"
    | "lynxtron-path-missing"
    | "harmony-package-missing";
  message: string;
  path?: string;
}

export interface LynxLibraryInspection {
  root: string;
  packageJson: Record<string, unknown> | null;
  manifestPath: string;
  manifest: LynxLibraryManifest | null;
  platforms: LynxLibraryPlatform[];
  issues: LynxLibraryIssue[];
  sourceStats: Partial<
    Record<LynxLibraryPlatform, { size: number; mtimeMs: number }>
  >;
}

export class LynxLibraryValidationError extends Error {
  readonly issues: readonly LynxLibraryIssue[];

  constructor(issues: readonly LynxLibraryIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "LynxLibraryValidationError";
    this.issues = issues;
  }
}

export interface CodegenCommand {
  executable: string;
  args: readonly string[];
  cwd: string;
}

export interface CodegenRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type LibraryWorkflowKind =
  | "codegen"
  | "build"
  | "test"
  | "pack"
  | "smoke";

export interface LibraryWorkflowProject {
  root: string;
  packageManager: LibraryPackageManager;
  scripts: Readonly<Record<string, string>>;
  example?: {
    root: string;
    packageManager: LibraryPackageManager;
    script: string;
  };
}

export interface LibraryWorkflowStep {
  id: string;
  kind: LibraryWorkflowKind;
  command: CodegenCommand;
  reason: string;
}

export interface LibraryWorkflowPlan {
  project: LibraryWorkflowProject;
  steps: readonly LibraryWorkflowStep[];
  warnings: readonly string[];
}

export interface LibraryWorkflowRunResult {
  step: LibraryWorkflowStep;
  result: CodegenRunResult;
}

export type LibraryWorkflowRunner = CodegenRunner;

export class LynxLibraryWorkflowError extends Error {
  readonly result: LibraryWorkflowRunResult;

  constructor(result: LibraryWorkflowRunResult) {
    super(
      `Library workflow step ${result.step.id} failed with exit code ${result.result.code}`,
    );
    this.name = "LynxLibraryWorkflowError";
    this.result = result;
  }
}

export type CodegenRunner = (
  executable: string,
  args: readonly string[],
  cwd: string,
) => Promise<CodegenRunResult>;

export const LYNX_LIBRARY_FEATURES = [
  "native-module",
  "napi-native-module",
  "element",
  "service",
] as const;

export type LynxLibraryFeature = (typeof LYNX_LIBRARY_FEATURES)[number];

export type LibraryPackageManager = "npm" | "pnpm" | "yarn";

export interface LibraryScaffoldOptions {
  root: string;
  directory: string;
  packageName: string;
  features: readonly LynxLibraryFeature[];
  platforms: readonly LynxLibraryPlatform[];
  packageManager?: LibraryPackageManager;
  androidPackage?: string;
  moduleName?: string;
  elementName?: string;
  serviceName?: string;
}
