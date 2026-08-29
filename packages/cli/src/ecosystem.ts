import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface EcosystemPackage {
  readonly name: string;
  readonly category: "tool" | "runtime" | "adapter";
  readonly purpose: string;
  readonly installed: boolean;
  readonly version?: string;
}

const CATALOG = [
  [
    "@lynxship/lynx-library-tools",
    "tool",
    "Validate Lynx library manifests and plan official Autolink codegen.",
  ],
  [
    "@lynxship/asset-pipeline",
    "tool",
    "Discover, hash, and verify build assets.",
  ],
  [
    "@lynxship/test-kit",
    "tool",
    "Plan declared tests without pretending to emulate native hosts.",
  ],
  [
    "@lynxship/permissions",
    "runtime",
    "Request permissions through an explicit native host adapter.",
  ],
  [
    "@lynxship/router",
    "runtime",
    "Resolve routes, history, and deep-link paths.",
  ],
  [
    "@lynxship/device-storage",
    "runtime",
    "Use an async device-storage adapter with typed JSON values.",
  ],
  [
    "@lynxship/i18n",
    "runtime",
    "Resolve locales and translations without global state.",
  ],
  [
    "@lynxship/media",
    "runtime",
    "Expose declared camera, microphone, and picker capabilities.",
  ],
  [
    "@lynxship/observability",
    "runtime",
    "Buffer bounded, redacted events into an explicit sink.",
  ],
  [
    "@lynxship/lynxtron",
    "adapter",
    "Verify Desktop/Lynxtron artifacts before host loading.",
  ],
  [
    "@lynxship/tailwind-lynx",
    "tool",
    "Validate and plan the official Tailwind ReactLynx preset.",
  ],
  [
    "@lynxship/ui-tokens",
    "tool",
    "Validate and emit deterministic design-token CSS.",
  ],
] as const;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function inspectEcosystem(
  root: string,
): Promise<readonly EcosystemPackage[]> {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as PackageJson;
  const installed = { ...manifest.dependencies, ...manifest.devDependencies };
  return CATALOG.map(([name, category, purpose]) => ({
    name,
    category,
    purpose,
    installed: Boolean(installed[name]),
    ...(installed[name] ? { version: installed[name] } : {}),
  }));
}
