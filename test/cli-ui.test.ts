import test from "node:test";
import assert from "node:assert/strict";
import { createColors } from "@lynxship/cli/ui/colors";
import { formatEvent } from "@lynxship/cli/ui/components";
import { LOGO } from "@lynxship/cli/ui/logo";
import { terminalOptions } from "@lynxship/cli/ui/terminal";

test("CLI colors can be disabled without ANSI escapes", () => {
  assert.equal(createColors(false).teal("LynxShip"), "LynxShip");
  assert.equal(createColors(false).brand("Build result"), "Build result");
});

test("CLI brand renderer produces the Lynx pink-to-cyan gradient", () => {
  const rendered = createColors(true).brand("Build result");
  assert.match(rendered, /\u001b\[38;2;255;107;157m/);
  assert.match(rendered, /\u001b\[38;2;69;183;209m/);
});

test("CLI logo is hardcoded Braille artwork", () => {
  assert.match(LOGO, /[\u2800-\u28ff]/);
  assert.equal(LOGO.split("\n").length, 20);
});

test("CLI output flags disable decorations consistently", () => {
  const options = terminalOptions([
    "build",
    "--json",
    "--no-color",
    "--non-interactive",
    "--verbose",
  ]);
  assert.deepEqual(options, {
    json: true,
    quiet: false,
    verbose: true,
    noColor: true,
    nonInteractive: true,
  });
});

test("CLI event journal uses semantic markers", () => {
  const stripAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, "");
  assert.match(stripAnsi(formatEvent("warning: no-source")), /^  ! /);
  assert.match(stripAnsi(formatEvent("ready built in 1s")), /^  (?:◆|\*) /);
  assert.match(stripAnsi(formatEvent("Build queued…")), /^  - /);
  assert.match(stripAnsi(formatEvent("Error: failed")), /^  x /);
  assert.match(stripAnsi(formatEvent("Gradle task output")), /^  (?:│|\|) /);
});
