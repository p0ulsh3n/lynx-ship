import test from "node:test";
import assert from "node:assert/strict";
import { createColors } from "@lynxship/cli/ui/colors";
import { formatEvent } from "@lynxship/cli/ui/components";
import {
  LYNXSHIP_QR_STYLE,
  renderTerminalQr,
} from "../packages/cli/src/ui/qr.js";
import { LOGO } from "@lynxship/cli/ui/logo";
import { terminalOptions } from "@lynxship/cli/ui/terminal";
import {
  extractDevServerUrl,
  shouldPrintDevServerQr,
} from "../packages/cli/src/dev-qr.js";

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

test("CLI extracts the Lynx Explorer QR URL from Rspeedy output", () => {
  assert.equal(
    extractDevServerUrl(
      "default: http://192.168.1.2:3000/main.lynx.bundle?fullscreen=true",
    ),
    "http://192.168.1.2:3000/main.lynx.bundle?fullscreen=true",
  );
  assert.equal(
    extractDevServerUrl(
      "Lynx http://192.168.1.2:3000/main.lynx.bundle Network: use --host",
    ),
    "http://192.168.1.2:3000/main.lynx.bundle",
  );
  assert.equal(
    extractDevServerUrl("default: lynx://192.168.1.2:3000/main.lynx.bundle"),
    "lynx://192.168.1.2:3000/main.lynx.bundle",
  );
  assert.equal(
    extractDevServerUrl("default: myapp://lynx-dev?url=http%3A%2F%2Fhost"),
    "myapp://lynx-dev?url=http%3A%2F%2Fhost",
  );
  assert.equal(shouldPrintDevServerQr("ready built in 5.21s"), true);
  assert.equal(
    shouldPrintDevServerQr("Lynx http://192.168.1.2:3000/main.lynx.bundle"),
    true,
  );
  assert.equal(shouldPrintDevServerQr("Network: use --host"), false);
});

test("CLI QR uses the WISA renderer settings with LynxShip branding", () => {
  const rendered = renderTerminalQr(
    "lynx://localhost:3000/main.lynx.bundle",
    true,
  );
  assert.equal(LYNXSHIP_QR_STYLE.qrOptions.errorCorrectionLevel, "H");
  assert.equal(LYNXSHIP_QR_STYLE.dotsOptions.type, "dots");
  assert.equal(LYNXSHIP_QR_STYLE.cornersSquareOptions.type, "dot");
  assert.equal("image" in LYNXSHIP_QR_STYLE, false);
  assert.match(rendered, /\u001b\[38;2;\d+;\d+;\d+m/);
  assert.match(rendered, /[▀▄█]/);
});
