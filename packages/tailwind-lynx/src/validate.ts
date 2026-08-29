import type {
  TailwindBuildPlan,
  TailwindProjectConfig,
  TailwindValidation,
} from "./contracts.js";

export const OFFICIAL_PRESET = "@lynx-js/tailwind-preset";

export function validateTailwindConfig(
  config: TailwindProjectConfig,
): TailwindValidation {
  const issues: string[] = [];
  if (!config.configPath)
    issues.push("No Tailwind configuration path was declared.");
  if (!config.content?.length)
    issues.push(
      "No content globs were declared; utility classes may be omitted from the build.",
    );
  if (config.presetPackage && config.presetPackage !== OFFICIAL_PRESET)
    issues.push(
      `The declared preset is '${config.presetPackage}', not the official '${OFFICIAL_PRESET}'.`,
    );
  return {
    valid: issues.length === 0,
    issues,
    recommendation:
      "Use the official @lynx-js/tailwind-preset and verify generated CSS against the target Lynx backend.",
  };
}

export function createTailwindBuildPlan(
  config: TailwindProjectConfig,
): TailwindBuildPlan {
  const validation = validateTailwindConfig(config);
  if (!validation.valid)
    throw new Error(
      `Invalid Tailwind ReactLynx configuration: ${validation.issues.join(" ")}`,
    );
  return {
    command: "tailwindcss",
    args: [
      "-c",
      config.configPath!,
      "-i",
      "./src/styles.css",
      "-o",
      "./dist/styles.css",
    ],
    reason:
      "Generate CSS through the project's official Tailwind pipeline; LynxShip does not reimplement Tailwind.",
  };
}
