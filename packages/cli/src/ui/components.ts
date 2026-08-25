import boxen from "boxen";
import { Chalk } from "chalk";
import cliProgress from "cli-progress";
import ora, { type Ora } from "ora";
import qrcode from "qrcode-terminal";
import type { ColorName } from "./colors.js";
import { c, colorsEnabled } from "./state.js";
import { supportsUnicode, terminalWidth } from "./terminal.js";
import { renderTerminalQr } from "./qr.js";

export interface BoxRow {
  label: string;
  value: string;
  valueColor?: ColorName;
}

export function sectionHeader(title: string): void {
  console.log(`\n${c.brandBold(`◆ LynxShip — ${title}`)}`);
}

export const log = {
  success(message: string): void {
    console.log(`  ${c.green("◆")} ${c.text(message)}`);
  },
  warn(message: string): void {
    console.log(`  ${c.yellow("!")} ${c.yellow(message)}`);
  },
  error(message: string): void {
    console.error(`  ${c.red("x")} ${c.red(message)}`);
  },
  info(message: string): void {
    console.log(`  ${c.muted(message)}`);
  },
  debug(message: string): void {
    console.log(`  ${c.dim(`debug: ${message}`)}`);
  },
};

const valueColors: Record<ColorName, (value: string) => string> = {
  teal: (value) => c.teal(value),
  tealDim: (value) => c.tealDim(value),
  blue: (value) => c.blue(value),
  orange: (value) => c.orange(value),
  yellow: (value) => c.yellow(value),
  red: (value) => c.red(value),
  purple: (value) => c.purple(value),
  green: (value) => c.green(value),
  text: (value) => c.text(value),
  muted: (value) => c.muted(value),
  dim: (value) => c.dim(value),
};

export function summaryBox(title: string, rows: BoxRow[]): void {
  const width = terminalWidth();
  const labelWidth = Math.min(
    16,
    Math.max(...rows.map((row) => row.label.length), 0),
  );
  const plain = rows
    .map((row) => `${row.label.padEnd(labelWidth)}  ${row.value}`)
    .join("\n");
  if (width < 58) {
    console.log(`\n${plain}`);
    return;
  }
  const content = rows
    .map((row) => {
      const label = c.muted(row.label.padEnd(labelWidth));
      const value = row.valueColor
        ? valueColors[row.valueColor](row.value)
        : c.text(row.value);
      return `${label}  ${value}`;
    })
    .join("\n");
  // Measure the plain title first. Coloring the title before boxen measures it
  // would make ANSI escape sequences affect the visible width of the border.
  const rendered = boxen(content, {
    width: Math.min(120, Math.max(56, width - 2)),
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderStyle: "round",
    borderColor: "#29495b",
    title,
    titleAlignment: "left",
  });
  const firstLineEnd = rendered.indexOf("\n");
  const firstLine =
    firstLineEnd === -1 ? rendered : rendered.slice(0, firstLineEnd);
  const titleStart = firstLine.indexOf(title);
  const coloredTitle =
    titleStart === -1
      ? firstLine
      : `${firstLine.slice(0, titleStart)}${c.brand(title)}${firstLine.slice(titleStart + title.length)}`;
  const coloredBox =
    firstLineEnd === -1
      ? coloredTitle
      : `${coloredTitle}${rendered.slice(firstLineEnd)}`;
  console.log(`\n${coloredBox}`);
}

export interface ProgressHandle {
  event(message: string): void;
  update(value?: number, label?: string): void;
  stop(): void;
}

type EventTone =
  | "command"
  | "step"
  | "success"
  | "warning"
  | "error"
  | "output";

function eventTone(message: string): EventTone {
  const normalized = message.trim().toLowerCase();
  if (normalized.startsWith("$ ")) return "command";
  if (
    normalized.includes("error") ||
    normalized.includes("failed") ||
    normalized.includes("exception")
  )
    return "error";
  if (
    normalized.includes("warning") ||
    normalized.includes("no-source") ||
    normalized.includes("deprecated")
  )
    return "warning";
  if (
    normalized.includes("successful") ||
    normalized.includes("ready") ||
    normalized.startsWith("artifact ready") ||
    normalized.startsWith("done")
  )
    return "success";
  if (
    normalized.startsWith("building ") ||
    normalized.startsWith("checking ") ||
    normalized.startsWith("syncing ") ||
    normalized.startsWith("running ") ||
    normalized.startsWith("uploading ") ||
    normalized.startsWith("verifying ") ||
    normalized.startsWith("build queued")
  )
    return "step";
  return "output";
}

export function formatEvent(message: string): string {
  const colors = {
    command: c.blue,
    step: c.teal,
    success: c.green,
    warning: c.yellow,
    error: c.red,
    output: c.text,
  };
  const tone = eventTone(message);
  const normalized = message.trim().replace(/^\$\s*/, "");
  const marker = {
    command: supportsUnicode() ? "➜" : ">",
    step: "-",
    success: supportsUnicode() ? "◆" : "*",
    warning: "!",
    error: "x",
    output: supportsUnicode() ? "│" : "|",
  }[tone];
  return `  ${colors[tone](marker)} ${colors[tone](normalized)}`;
}

function formatEventRail(): string {
  return `  ${c.text(supportsUnicode() ? "│" : "|")}`;
}

const activeAnimations = new Set<() => void>();
let cleanupHooksInstalled = false;

function installCleanupHooks(): void {
  if (cleanupHooksInstalled) return;
  cleanupHooksInstalled = true;
  const cleanup = (): void => {
    for (const stop of activeAnimations) stop();
    activeAnimations.clear();
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exitCode = 130;
  });
}

function trackAnimation(stop: () => void): () => void {
  installCleanupHooks();
  activeAnimations.add(stop);
  return () => activeAnimations.delete(stop);
}

export function createProgress(
  label: string,
  enabled: boolean,
): ProgressHandle {
  if (!enabled)
    return {
      event: () => undefined,
      update: () => undefined,
      stop: () => undefined,
    };
  const spinnerFrames = supportsUnicode()
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["|", "/", "-", "\\"];
  let spinnerIndex = 0;
  let currentValue = 0;
  let hasMeasuredValue = false;
  let previousTone: EventTone | undefined;
  const formatPercent = (value: number): string =>
    `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
  const bar = new cliProgress.SingleBar({
    format: `  {spinner} {stage} ${c.teal("{bar}")} ${c.muted("{percent}")}`,
    barCompleteChar: "█",
    barIncompleteChar: "░",
    barsize: 20,
    hideCursor: true,
    clearOnComplete: true,
  });
  const stage = (value: string): string => c.muted(value.padEnd(38));
  const payload = (value: string) => ({
    stage: stage(value),
    spinner: c.brand(spinnerFrames[spinnerIndex] ?? ""),
    percent: hasMeasuredValue ? formatPercent(currentValue) : "",
  });
  let currentLabel = label;
  bar.start(100, currentValue, payload(currentLabel));
  const timer = setInterval(() => {
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    bar.update(currentValue, payload(currentLabel));
  }, 120);
  timer.unref?.();
  const untrack = trackAnimation(() => {
    clearInterval(timer);
    bar.stop();
  });
  const logEvent = (message: string): void => {
    if (!bar.isActive) return;
    const tone = eventTone(message);
    bar.stop();
    if (
      tone !== "output" &&
      (previousTone === undefined || previousTone === "output")
    )
      console.log(formatEventRail());
    console.log(formatEvent(message));
    if (tone !== "output") console.log(formatEventRail());
    bar.start(100, currentValue, payload(currentLabel));
    previousTone = tone;
  };
  return {
    event: logEvent,
    update: (value, nextLabel) => {
      if (value !== undefined) {
        currentValue = Math.min(100, Math.max(0, value));
        hasMeasuredValue = true;
      }
      if (nextLabel) currentLabel = nextLabel;
      bar.update(currentValue, payload(currentLabel));
    },
    stop: () => {
      clearInterval(timer);
      bar.stop();
      untrack();
    },
  };
}

export interface SpinnerHandle {
  succeed(message: string): void;
  fail(message: string): void;
  stop(): void;
}

export function spin(text: string, enabled: boolean): SpinnerHandle {
  if (!enabled)
    return {
      succeed: () => undefined,
      fail: () => undefined,
      stop: () => undefined,
    };
  const spinner: Ora = ora({
    text: c.brand(text),
    spinner: "dots",
    color: "cyan",
  }).start();
  const untrack = trackAnimation(() => spinner.stop());
  return {
    succeed: (message) => {
      spinner.succeed(`${c.green("◆")} ${c.text(message)}`);
      untrack();
    },
    fail: (message) => {
      spinner.fail(`${c.red("x")} ${c.red(message)}`);
      untrack();
    },
    stop: () => {
      spinner.stop();
      untrack();
    },
  };
}

function pillStyle(
  background: string,
  foreground: string,
  text: string,
): string {
  return new Chalk({ level: colorsEnabled ? 3 : 0 })
    .bgHex(background)
    .hex(foreground)(` ${text} `);
}

export const pill = {
  success: (text: string) => pillStyle("#0d2e22", "#10B981", text),
  warn: (text: string) => pillStyle("#2e2208", "#FFD166", text),
  info: (text: string) => pillStyle("#0a1f30", "#4F9EFF", text),
  error: (text: string) => pillStyle("#2e0d10", "#FF4757", text),
};

export function finalLine(message: string, success = true): void {
  console.log(`\n${success ? c.brand("◆") : c.red("◆")} ${c.text(message)}`);
}

export function nextSteps(
  commands: string[],
  note?: string,
  environment?: string,
): void {
  if (commands.length === 0) return;
  console.error(`\n${c.yellow("Next steps")}`);
  if (environment) console.error(`  ${c.muted(`Run on ${environment}:`)}`);
  commands.forEach((command, index) => {
    console.error(`  ${c.muted(`${index + 1}.`)} ${c.teal(command)}`);
  });
  if (note) console.error(`  ${c.muted(note)}`);
}

export function downloadArtifact(
  url: string,
  expiresAt?: string,
  enabled = true,
): void {
  if (!enabled) return;
  console.log(`\n${c.brandBold("Download artifact")}`);
  // qrcode-terminal's small mode is the safest compact terminal renderer.
  // A shorter QR requires a shorter download URL, not fewer QR modules.
  qrcode.generate(url, { small: true }, (code) => console.log(code));
  console.log(`  ${c.teal("URL")}  ${url}`);
  if (expiresAt) console.log(`  ${c.muted(`Link expires at ${expiresAt}`)}`);
}

export async function devServerQr(url: string, enabled = true): Promise<void> {
  if (!enabled) return;
  const rail = c.teal("│");
  const printRail = (value = ""): void => console.log(`  ${rail}${value}`);
  printRail();
  printRail(` ${c.brandBold("Lynx Explorer")}`);
  if (colorsEnabled && supportsUnicode()) {
    (await renderTerminalQr(url))
      .split("\n")
      .forEach((line) => printRail(` ${line}`));
  } else {
    qrcode.generate(url, { small: true }, (code) => {
      code.split("\n").forEach((line) => printRail(` ${line}`));
    });
  }
  printRail();
  printRail(` ${c.teal("URL")}  ${url}`);
  printRail();
  console.log();
}
