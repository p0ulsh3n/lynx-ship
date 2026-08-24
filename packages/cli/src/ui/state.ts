import { createColors, type CliColors } from "./colors.js";

export let c: CliColors = createColors(true);

export let colorsEnabled = true;

export function setColors(enabled: boolean): void {
  colorsEnabled = enabled;
  c = createColors(enabled);
}
