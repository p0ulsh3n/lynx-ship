import type { CreateAppOptions } from "./model.js";

export const CREATE_APP_HELP = `Usage: create-lynxship-app [project-name] [options]

Create a new LynxJS application using an official Lynx scaffold.

Options:
  -d, --dir <directory>       Create the project in a specific directory
  -t, --template <template>   react-ts (default), react-js, vue-ts or vue-js
      --no-install             Skip dependency installation
      --no-git                  Skip Git repository initialization
  -h, --help                  Show this help
  -v, --version               Show the version

Examples:
  npx create-lynxship-app@latest my-app
  npm create lynxship-app@latest my-app
  pnpm create lynxship-app@latest my-app --template react-ts
  pnpm create lynxship-app@latest my-app --template vue-ts
`;

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseArguments(args: string[]): CreateAppOptions & {
  readonly help: boolean;
  readonly version: boolean;
} {
  let projectName: string | undefined;
  let directory: string | undefined;
  let template: CreateAppOptions["template"] = "react-ts";
  let install = true;
  let git = true;
  let help = false;
  let version = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === "--") {
      const value = args[index + 1];
      if (value) {
        if (projectName) throw new Error("Only one project name is allowed.");
        projectName = value;
        index += 1;
      }
      continue;
    }
    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "-v" || argument === "--version") {
      version = true;
      continue;
    }
    if (argument === "--no-install") {
      install = false;
      continue;
    }
    if (argument === "--no-git") {
      git = false;
      continue;
    }
    if (
      argument === "-d" ||
      argument === "--dir" ||
      argument === "--directory"
    ) {
      directory = valueAfter(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "-t" || argument === "--template") {
      const value = valueAfter(args, index, argument);
      if (
        value !== "react-ts" &&
        value !== "react-js" &&
        value !== "vue-ts" &&
        value !== "vue-js"
      ) {
        throw new Error(
          `Unsupported template '${value}'. Use react-ts, react-js, vue-ts or vue-js.`,
        );
      }
      template = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown option '${argument}'. Run with --help.`);
    }
    if (projectName) throw new Error("Only one project name is allowed.");
    projectName = argument;
  }

  if (projectName && directory) {
    throw new Error("Use either a project name or --dir, not both.");
  }

  return { projectName, directory, template, install, git, help, version };
}
