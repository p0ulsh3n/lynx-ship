import { LYNX_BRAND } from "./colors.js";
import { terminalWidth } from "./terminal.js";
import { createRequire } from "node:module";

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

interface StyledQr {
  getRawData(extension: "svg"): Promise<Buffer | Uint8Array | null>;
}

interface StyledQrConstructor {
  new (options: Record<string, unknown>): StyledQr;
}

interface ResvgConstructor {
  new (svg: string): {
    render(): {
      asPng(): Uint8Array;
    };
  };
}

interface PngImage {
  width: number;
  height: number;
  data: Uint8Array;
}

interface PngDecoder {
  sync: {
    read(buffer: Buffer): PngImage;
  };
}

interface JSDomConstructor {
  new (...args: unknown[]): unknown;
}

interface RuntimeQrDependencies {
  QRCodeStyling: StyledQrConstructor;
  JSDOM: JSDomConstructor;
  Resvg: ResvgConstructor;
  PNG: PngDecoder;
}

async function loadDependencies(): Promise<RuntimeQrDependencies> {
  const require = createRequire(import.meta.url);
  const qrModule = require("qr-code-styling") as
    | { default?: StyledQrConstructor }
    | StyledQrConstructor;
  const jsdomModule = require("jsdom") as { JSDOM: JSDomConstructor };
  const resvgModule = require("@resvg/resvg-js") as {
    Resvg: ResvgConstructor;
  };
  const pngModule = require("pngjs") as { PNG: PngDecoder };
  return {
    QRCodeStyling:
      "default" in qrModule && qrModule.default
        ? qrModule.default
        : (qrModule as StyledQrConstructor),
    JSDOM: jsdomModule.JSDOM,
    Resvg: resvgModule.Resvg,
    PNG: pngModule.PNG,
  };
}

function ansiColor(
  channel: "38" | "48",
  red: number,
  green: number,
  blue: number,
): string {
  return "\u001b[" + channel + ";2;" + red + ";" + green + ";" + blue + "m";
}

function pixelAt(
  image: PngImage,
  x: number,
  y: number,
): [number, number, number, number] {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset] ?? 255,
    image.data[offset + 1] ?? 255,
    image.data[offset + 2] ?? 255,
    image.data[offset + 3] ?? 255,
  ];
}

function isBackground([red, green, blue, alpha]: [
  number,
  number,
  number,
  number,
]): boolean {
  return alpha < 16 || (red > 248 && green > 248 && blue > 248);
}

function cropToQrContent(image: PngImage): PngImage {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!isBackground(pixelAt(image, x, y))) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right < left || bottom < top) return image;

  const padding = Math.max(
    3,
    Math.round(Math.min(image.width, image.height) * 0.02),
  );
  const cropLeft = Math.max(0, left - padding);
  const cropTop = Math.max(0, top - padding);
  const cropRight = Math.min(image.width - 1, right + padding);
  const cropBottom = Math.min(image.height - 1, bottom + padding);
  const width = cropRight - cropLeft + 1;
  const height = cropBottom - cropTop + 1;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((cropTop + y) * image.width + cropLeft + x) * 4;
      const target = (y * width + x) * 4;
      data[target] = image.data[source] ?? 255;
      data[target + 1] = image.data[source + 1] ?? 255;
      data[target + 2] = image.data[source + 2] ?? 255;
      data[target + 3] = image.data[source + 3] ?? 255;
    }
  }

  return { width, height, data };
}

function renderRasterInTerminal(image: PngImage): string {
  const columns = Math.max(35, Math.min(72, terminalWidth() - 8));
  const scale = image.width / columns;
  const rows = Math.ceil(image.height / scale / 2);
  const lines: string[] = [];
  const whiteBackground = ansiColor("48", 255, 255, 255);
  const reset = "\u001b[0m";

  for (let row = 0; row < rows; row += 1) {
    const topY = Math.min(image.height - 1, Math.floor(row * 2 * scale));
    const bottomY = Math.min(
      image.height - 1,
      Math.floor((row * 2 + 1) * scale),
    );
    let line = whiteBackground;
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(image.width - 1, Math.floor(column * scale));
      const top = pixelAt(image, x, topY);
      const bottom = pixelAt(image, x, bottomY);
      const topBackground = isBackground(top);
      const bottomBackground = isBackground(bottom);

      if (topBackground && bottomBackground) {
        line += " ";
      } else if (!topBackground && bottomBackground) {
        line +=
          ansiColor("38", top[0], top[1], top[2]) +
          ansiColor("48", 255, 255, 255) +
          "▀";
      } else if (topBackground && !bottomBackground) {
        line +=
          ansiColor("38", bottom[0], bottom[1], bottom[2]) +
          ansiColor("48", 255, 255, 255) +
          "▄";
      } else {
        line +=
          ansiColor("38", top[0], top[1], top[2]) +
          ansiColor("48", bottom[0], bottom[1], bottom[2]) +
          "▀";
      }
    }
    lines.push(line + reset);
  }
  return lines.join("\n");
}

/**
 * Generate the QR with qr-code-styling itself, exactly like the WISA renderer.
 * The SVG is then rasterized only to make the library's real rounded shapes
 * displayable in a normal terminal; no QR modules are recreated by LynxShip.
 */
export async function renderTerminalQr(data: string): Promise<string> {
  const { QRCodeStyling, JSDOM, Resvg, PNG } = await loadDependencies();
  const qrCode = new QRCodeStyling({
    jsdom: JSDOM,
    data,
    ...LYNXSHIP_QR_STYLE,
  });
  const svg = await qrCode.getRawData("svg");
  if (!svg) throw new Error("qr-code-styling returned no SVG data");
  const svgText = Buffer.isBuffer(svg)
    ? svg.toString("utf8")
    : new TextDecoder().decode(svg);
  // jsdom serializes SVG references as url('#id'). Normalize only those
  // references for resvg; the SVG generated by qr-code-styling is unchanged
  // for browsers and for the file returned by the library.
  const rasterSvg = svgText.replaceAll("url('#", "url(#").replaceAll("')", ")");
  const png = new Resvg(rasterSvg).render().asPng();
  const image = cropToQrContent(PNG.sync.read(Buffer.from(png)));
  return renderRasterInTerminal(image);
}
