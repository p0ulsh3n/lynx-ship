import qrcodeGenerator from "qrcode-generator";
import { LYNX_BRAND } from "./colors.js";

export const LYNXSHIP_QR_STYLE = {
  type: "svg",
  width: 300,
  height: 300,
  margin: 0,
  qrOptions: { errorCorrectionLevel: "H" },
  dotsOptions: {
    type: "dots",
    gradient: {
      type: "linear",
      rotation: (50 * Math.PI) / 180,
      colorStops: [
        { offset: 0, color: LYNX_BRAND.pink },
        { offset: 1, color: LYNX_BRAND.cyan },
      ],
    },
  },
  cornersSquareOptions: {
    type: "dot",
    gradient: {
      type: "linear",
      rotation: (50 * Math.PI) / 180,
      colorStops: [
        { offset: 0, color: LYNX_BRAND.pink },
        { offset: 1, color: LYNX_BRAND.cyan },
      ],
    },
  },
  cornersDotOptions: {
    type: "dot",
    gradient: {
      type: "linear",
      rotation: (50 * Math.PI) / 180,
      colorStops: [
        { offset: 0, color: LYNX_BRAND.pink },
        { offset: 1, color: LYNX_BRAND.cyan },
      ],
    },
  },
  backgroundOptions: { color: "#FFFFFF" },
} as const;

interface QrMatrix {
  addData(data: string, mode?: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, column: number): boolean;
}

type Rgb = [number, number, number];

const QUIET_ZONE = 2;
const RESET = "\u001b[0m";
const WHITE_BACKGROUND = "\u001b[48;2;255;255;255m";

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function colorAt(row: number, column: number, size: number): Rgb {
  const angle = LYNXSHIP_QR_STYLE.dotsOptions.gradient.rotation;
  const x = size <= 1 ? 0 : column / (size - 1);
  const y = size <= 1 ? 0 : row / (size - 1);
  const projection = x * Math.cos(angle) + y * Math.sin(angle);
  const minimum = Math.min(0, Math.cos(angle), Math.sin(angle));
  const maximum = Math.max(0, Math.cos(angle), Math.sin(angle));
  const ratio = Math.max(
    0,
    Math.min(1, (projection - minimum) / (maximum - minimum)),
  );
  const start = hexToRgb(
    LYNXSHIP_QR_STYLE.dotsOptions.gradient.colorStops[0].color,
  );
  const end = hexToRgb(
    LYNXSHIP_QR_STYLE.dotsOptions.gradient.colorStops[1].color,
  );
  return [
    Math.round(start[0] + (end[0] - start[0]) * ratio),
    Math.round(start[1] + (end[1] - start[1]) * ratio),
    Math.round(start[2] + (end[2] - start[2]) * ratio),
  ];
}

function ansiForeground([red, green, blue]: Rgb): string {
  return `\u001b[38;2;${red};${green};${blue}m`;
}

function moduleAt(
  matrix: QrMatrix,
  row: number,
  column: number,
  size: number,
): boolean {
  if (
    row < QUIET_ZONE ||
    column < QUIET_ZONE ||
    row >= size + QUIET_ZONE ||
    column >= size + QUIET_ZONE
  )
    return false;
  return matrix.isDark(row - QUIET_ZONE, column - QUIET_ZONE);
}

/**
 * Render the same QR styling tokens as qr-code-styling in a terminal.
 *
 * qr-code-styling produces SVG/canvas output, which a normal terminal cannot
 * display. The terminal adapter therefore uses its public QR matrix engine
 * and applies the exact shared ECC, gradient, rotation and quiet-zone values.
 */
export function renderTerminalQr(data: string, colored: boolean): string {
  const matrix = qrcodeGenerator(0, "H") as QrMatrix;
  matrix.addData(data, "Byte");
  matrix.make();
  const size = matrix.getModuleCount();
  const fullSize = size + QUIET_ZONE * 2;
  const lines: string[] = [];

  for (let row = 0; row < fullSize; row += 2) {
    let line = colored ? WHITE_BACKGROUND : "";
    for (let column = 0; column < fullSize; column += 1) {
      const top = moduleAt(matrix, row, column, size);
      const bottom = moduleAt(matrix, row + 1, column, size);
      if (!top && !bottom) {
        line += " ";
        continue;
      }
      if (!colored) {
        line += top && bottom ? "█" : top ? "▀" : "▄";
        continue;
      }
      const topColor = colorAt(row, column, fullSize);
      const bottomColor = colorAt(row + 1, column, fullSize);
      if (top && bottom) {
        line += `${ansiForeground(topColor)}█`;
      } else if (top) {
        line += `${ansiForeground(topColor)}▀`;
      } else {
        line += `${ansiForeground(bottomColor)}▄`;
      }
    }
    lines.push(`${line}${colored ? RESET : ""}`);
  }
  return lines.join("\n");
}
