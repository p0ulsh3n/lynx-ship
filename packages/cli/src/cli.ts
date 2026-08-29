#!/usr/bin/env node

import { runEarlyCommand, commandHeader } from "./runtime/early-commands.js";
import { createCliRuntime } from "./runtime/context.js";
import { runBuildOrStateCommand } from "./runtime/build-commands.js";
import { guidanceForError } from "./guidance.js";
import { exitCode } from "./commands/metadata.js";

const rawArgs = process.argv.slice(2);
const context = createCliRuntime(rawArgs);

async function runCli(): Promise<void> {
  const command = context.args.shift() ?? "help";
  const wantsHelp =
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    rawArgs.includes("--help") ||
    rawArgs.includes("-h");
  const shouldShowBanner =
    !context.json &&
    (wantsHelp || rawArgs.length === 0 || rawArgs.includes("--banner"));
  if (shouldShowBanner) context.ui.banner();

  if (wantsHelp) {
    const { helpText } = await import("./commands/help.js");
    if (context.ui.interactive) context.ui.header("Help");
    context.printValue(helpText());
    return;
  }

  context.ui.header(commandHeader(command, context.args));
  context.ui.debug(`cwd=${context.root}`);

  if (await runEarlyCommand(context, command)) return;
  await runBuildOrStateCommand(context, command);
}

void runCli()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    const code = (error as { code?: string }).code ?? "CLI_ERROR";
    const nextSteps = guidanceForError(error, { args: rawArgs });
    if (context.json) {
      console.log(
        JSON.stringify({
          error: message,
          code,
          ...(nextSteps.commands.length > 0
            ? {
                nextSteps: nextSteps.commands,
                ...(nextSteps.note ? { note: nextSteps.note } : {}),
                ...(nextSteps.environment
                  ? { environment: nextSteps.environment }
                  : {}),
              }
            : {}),
        }),
      );
    } else {
      context.ui.error(message);
      context.ui.nextSteps(nextSteps);
    }
    process.exitCode = exitCode(error);
  })
  .finally(async () => {
    try {
      await context.renderConfigurationFooter();
    } catch {
      // Configuration status must never hide the original command result.
    }
  });
