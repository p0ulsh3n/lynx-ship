export interface TerminalOptions {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  noColor: boolean;
  nonInteractive: boolean;
}

export function terminalOptions(args: string[]): TerminalOptions {
  return {
    json: args.includes("--json"),
    quiet: args.includes("--quiet"),
    verbose: args.includes("--verbose"),
    noColor: args.includes("--no-color") || Boolean(process.env.NO_COLOR),
    nonInteractive:
      args.includes("--non-interactive") || process.env.CI === "1",
  };
}

export function isInteractive(options: TerminalOptions): boolean {
  return (
    Boolean(process.stdout.isTTY) &&
    !options.json &&
    !options.quiet &&
    !options.noColor &&
    !options.nonInteractive
  );
}

export function supportsUnicode(): boolean {
  return (
    process.env.TERM !== "dumb" &&
    process.env.TERM_PROGRAM !== "Apple_Terminal_legacy"
  );
}

export function terminalWidth(): number {
  return process.stdout.columns ?? 80;
}
