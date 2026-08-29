import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  LYNX_LIBRARY_FEATURES,
  LYNX_LIBRARY_PLATFORMS,
  type CodegenCommand,
  type CodegenRunResult,
  type CodegenRunner,
  type LibraryScaffoldOptions,
} from "./contracts.js";

const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const NATIVE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function inside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith(".." + sep) && !isAbsolute(path));
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
}

function assertNativeName(value: string | undefined, label: string): void {
  if (value !== undefined && !NATIVE_NAME.test(value))
    throw new Error(`${label} must be a valid identifier.`);
}

export function createLibraryScaffoldCommand(
  options: LibraryScaffoldOptions,
): CodegenCommand {
  assertNonEmpty(options.root, "Library root");
  assertNonEmpty(options.directory, "Library directory");
  if (!PACKAGE_NAME.test(options.packageName))
    throw new Error("Library packageName must be a valid npm package name.");
  if (!options.features.length)
    throw new Error("At least one Lynx library feature is required.");
  if (
    options.features.some((feature) => !LYNX_LIBRARY_FEATURES.includes(feature))
  )
    throw new Error("Library features contain an unsupported value.");
  if (!options.platforms.length)
    throw new Error("At least one Lynx library platform is required.");
  if (
    options.platforms.some(
      (platform) => !LYNX_LIBRARY_PLATFORMS.includes(platform),
    )
  )
    throw new Error("Library platforms contain an unsupported value.");
  const root = resolve(options.root);
  const directory = resolve(root, options.directory);
  if (!inside(root, directory) || directory === root)
    throw new Error("Library directory must stay inside the workspace root.");
  assertNativeName(options.moduleName, "moduleName");
  assertNativeName(options.elementName, "elementName");
  assertNativeName(options.serviceName, "serviceName");
  if (
    options.androidPackage !== undefined &&
    !/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/.test(options.androidPackage)
  )
    throw new Error("androidPackage must be a fully-qualified lowercase name.");

  const directoryArg = relative(root, directory).split(sep).join("/");
  const executable = options.packageManager ?? "npm";
  const args = [
    "create",
    "lynx-library",
    "--",
    "--dir",
    directoryArg,
    "--features",
    [...new Set(options.features)].join(","),
    "--platforms",
    [...new Set(options.platforms)].join(","),
    "--package-name",
    options.packageName,
  ];
  const optional = [
    ["--android-package", options.androidPackage],
    ["--module-name", options.moduleName],
    ["--element-name", options.elementName],
    ["--service-name", options.serviceName],
  ] as const;
  for (const [flag, value] of optional)
    if (value !== undefined) args.push(flag, value);
  return { executable, args, cwd: root };
}

export async function runLibraryScaffold(
  command: CodegenCommand,
  runner: CodegenRunner,
): Promise<CodegenRunResult> {
  const result = await runner(command.executable, command.args, command.cwd);
  if (!Number.isInteger(result.code))
    throw new Error("Lynx library scaffold returned an invalid exit code");
  return result;
}
