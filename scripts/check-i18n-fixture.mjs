import { readFile } from "node:fs/promises";

const bundlePath = new URL(
  "../examples/lynx-i18n-demo/dist/main.lynx.bundle",
  import.meta.url,
);
const bundle = await readFile(bundlePath, "utf8");
const requiredMarkers = [
  "LynxShip i18n",
  "i18n LynxShip",
  "تدويل LynxShip",
  "PluralRules",
  "polyfill",
  "useLynxI18next",
  "getCustomSectionSync",
];
const missing = requiredMarkers.filter((marker) => !bundle.includes(marker));

if (missing.length > 0) {
  throw new Error(`i18n fixture bundle is missing: ${missing.join(", ")}`);
}

console.log(
  `i18n fixture bundle check passed: ${bundle.length} bytes and ${requiredMarkers.length} markers present`,
);
