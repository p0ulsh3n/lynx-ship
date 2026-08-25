import {
  finalLine,
  log,
  sectionHeader,
  summaryBox,
  nextSteps,
  createProgress,
  spin,
  downloadArtifact,
  devServerQr,
  type BoxRow,
  type ProgressHandle,
  type SpinnerHandle,
} from "./components.js";
import { printBanner } from "./logo.js";
import { setColors } from "./state.js";
import {
  isInteractive,
  terminalOptions,
  type TerminalOptions,
} from "./terminal.js";
import type { CliGuidance } from "../guidance.js";

export class CliUi {
  readonly options: TerminalOptions;

  readonly interactive: boolean;

  constructor(args: string[]) {
    this.options = terminalOptions(args);
    this.interactive = isInteractive(this.options);
    setColors(
      !this.options.noColor &&
        !this.options.json &&
        (this.interactive || this.options.verbose),
    );
  }

  banner(): void {
    if (this.interactive) printBanner();
  }

  header(title: string): void {
    if (this.interactive) sectionHeader(title);
  }

  success(message: string): void {
    if (this.interactive && !this.options.quiet) log.success(message);
  }

  warn(message: string): void {
    if (!this.options.json) log.warn(message);
  }

  info(message: string): void {
    if (this.interactive && !this.options.quiet) log.info(message);
  }

  debug(message: string): void {
    if (this.options.verbose && !this.options.json && !this.options.quiet)
      log.debug(message);
  }

  error(message: string): void {
    if (!this.options.json) log.error(message);
  }

  nextSteps(guidance: CliGuidance): void {
    if (this.options.json || this.options.quiet) return;
    nextSteps(guidance.commands, guidance.note, guidance.environment);
  }

  summary(title: string, rows: BoxRow[]): void {
    if (this.interactive) summaryBox(title, rows);
  }

  configurationStatus(rows: BoxRow[]): void {
    if (this.interactive && !this.options.quiet)
      summaryBox("Configuration status", rows);
  }

  progress(label: string): ProgressHandle {
    return createProgress(label, this.interactive && !this.options.quiet);
  }

  spinner(text: string): SpinnerHandle {
    return spin(text, this.interactive && !this.options.quiet);
  }

  done(message: string, success = true): void {
    if (this.interactive) finalLine(message, success);
  }

  downloadArtifact(url: string, expiresAt?: string): void {
    downloadArtifact(url, expiresAt, this.interactive);
  }

  devServerQr(url: string): void {
    // Rspeedy suppresses its own QR when its stdout is piped. LynxShip
    // captures that output, so render the fallback unless the caller asked
    // for machine JSON, quiet output, or an explicitly non-interactive run.
    devServerQr(
      url,
      !this.options.json && !this.options.quiet && !this.options.nonInteractive,
    );
  }
}

export function createCliUi(args: string[]): CliUi {
  return new CliUi(args);
}

export { terminalOptions };

export type { BoxRow, ProgressHandle, TerminalOptions };
