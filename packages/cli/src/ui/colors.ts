import { Chalk, type ChalkInstance } from "chalk";

export const LYNX_BRAND = {
  pink: "#ff6b9d",
  cyan: "#45b7d1",
} as const;

export type ColorName =
  | "teal"
  | "tealDim"
  | "blue"
  | "orange"
  | "yellow"
  | "red"
  | "purple"
  | "green"
  | "text"
  | "muted"
  | "dim";

export interface CliColors {
  brand: (value: string) => string;
  brandBold: (value: string) => string;
  teal: ChalkInstance;
  tealDim: ChalkInstance;
  blue: ChalkInstance;
  orange: ChalkInstance;
  yellow: ChalkInstance;
  red: ChalkInstance;
  purple: ChalkInstance;
  green: ChalkInstance;
  text: ChalkInstance;
  muted: ChalkInstance;
  dim: ChalkInstance;
  bold: (value: string) => string;
}

function createColor(hex: string, enabled: boolean): ChalkInstance {
  return new Chalk({ level: enabled ? 3 : 0 }).hex(hex);
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function createBrand(enabled: boolean): (value: string) => string {
  const brandChalk = new Chalk({ level: enabled ? 3 : 0 });
  const [startRed, startGreen, startBlue] = hexToRgb(LYNX_BRAND.pink);
  const [endRed, endGreen, endBlue] = hexToRgb(LYNX_BRAND.cyan);

  return (value) => {
    if (!enabled || value.length === 0) return value;

    const characters = [...value];
    const visibleCount = characters.filter(
      (character) => !/\s/u.test(character),
    ).length;
    let visibleIndex = 0;

    return characters
      .map((character) => {
        if (/\s/u.test(character)) return character;
        const ratio = visibleCount <= 1 ? 0 : visibleIndex / (visibleCount - 1);
        visibleIndex += 1;
        const red = Math.round(startRed + (endRed - startRed) * ratio);
        const green = Math.round(startGreen + (endGreen - startGreen) * ratio);
        const blue = Math.round(startBlue + (endBlue - startBlue) * ratio);
        return brandChalk.hex(rgbToHex(red, green, blue))(character);
      })
      .join("");
  };
}

export function createColors(enabled: boolean): CliColors {
  const brand = createBrand(enabled);
  return {
    brand,
    brandBold: (value) =>
      new Chalk({ level: enabled ? 3 : 0 }).bold(brand(value)),
    teal: createColor(LYNX_BRAND.cyan, enabled),
    tealDim: createColor("#2f91ab", enabled),
    blue: createColor("#72c7df", enabled),
    orange: createColor("#ff9a8b", enabled),
    yellow: createColor("#f6c15d", enabled),
    red: createColor("#ff6b7a", enabled),
    purple: createColor("#c5a0ff", enabled),
    green: createColor("#58d6b4", enabled),
    text: createColor("#f4f8fb", enabled),
    muted: createColor("#91a8b8", enabled),
    dim: createColor("#526b7c", enabled),
    bold: new Chalk({ level: enabled ? 3 : 0 }).bold,
  };
}
