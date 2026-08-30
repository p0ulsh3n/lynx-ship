import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type LynxFramework =
  | "react"
  | "vue"
  | "octane"
  | "miso"
  | "vanilla"
  | "unknown";

export interface FrameworkDetection {
  framework: LynxFramework;
  label: string;
  evidence: string;
  buildSystem: "rspeedy" | "miso-nix" | "unknown";
  experimental: boolean;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function readText(file: string): Promise<string> {
  return readFile(file, "utf8").catch(() => "");
}

async function readManifest(root: string): Promise<PackageManifest> {
  try {
    return JSON.parse(
      await readText(join(root, "package.json")),
    ) as PackageManifest;
  } catch {
    return {};
  }
}

function dependencyNames(manifest: PackageManifest): Set<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

function hasAny(names: Set<string>, candidates: string[]): string | undefined {
  return candidates.find((name) => names.has(name));
}

export async function detectLynxFramework(
  root: string,
): Promise<FrameworkDetection> {
  const manifest = await readManifest(root);
  const names = dependencyNames(manifest);
  const scripts = Object.values(manifest.scripts ?? {}).join(" ");
  const configFiles = [
    "lynx.config.ts",
    "lynx.config.js",
    "lynx.config.mjs",
    "lynx.config.cjs",
    "app.config.ts",
    "app.config.js",
    "app.config.mjs",
    "app.config.cjs",
    "octane.config.ts",
    "octane.config.js",
  ];
  const config = (
    await Promise.all(
      configFiles
        .filter((file) => existsSync(join(root, file)))
        .map((file) => readText(join(root, file))),
    )
  ).join("\n");
  const flake = await readText(join(root, "flake.nix"));
  const cabal = await readText(join(root, "cabal.project"));
  const hasCabalFile = existsSync(join(root, "cabal.project"));
  const hasMiso =
    hasAny(names, ["miso", "miso-lynx"]) ||
    (existsSync(join(root, "flake.nix")) &&
      /miso|mkLynxBundle|Miso\\.Native|lynx/i.test(flake + "\n" + cabal)) ||
    (hasCabalFile && /miso|lynx/i.test(cabal));

  if (hasMiso) {
    return {
      framework: "miso",
      label: "Miso (Haskell)",
      evidence: "Miso.Native/Haskell project detected",
      buildSystem: "miso-nix",
      experimental: true,
    };
  }

  const hasOctane =
    hasAny(names, ["octane", "@octanejs/lynx", "@octanejs/rspeedy-plugin"]) ||
    existsSync(join(root, "octane.config.ts")) ||
    existsSync(join(root, "octane.config.js")) ||
    /pluginOctane|@jsxImportSource\\s+octane|\\.tsrx\\b/.test(config + scripts);

  if (hasOctane) {
    return {
      framework: "octane",
      label: "Octane",
      evidence: "Octane compiler/Rspeedy integration detected",
      buildSystem: "rspeedy",
      experimental: true,
    };
  }

  const vueDependency = hasAny(names, ["vue-lynx", "@lynx-js/vue"]);
  if (vueDependency || /pluginVueLynx|vue-lynx/i.test(config)) {
    return {
      framework: "vue",
      label: "Vue Lynx",
      evidence: "Vue Lynx integration detected",
      buildSystem: "rspeedy",
      experimental: false,
    };
  }

  if (hasAny(names, ["@lynx-js/react", "@lynx-js/react-rsbuild-plugin"])) {
    return {
      framework: "react",
      label: "ReactLynx",
      evidence: "official ReactLynx package detected",
      buildSystem: "rspeedy",
      experimental: false,
    };
  }

  if (
    names.has("@lynx-js/rspeedy") ||
    /rspeedy|lynxConfig\s*:|environments\s*:/i.test(config + scripts)
  ) {
    return {
      framework: "vanilla",
      label: "Vanilla Lynx",
      evidence: "Rspeedy/Lynx project detected",
      buildSystem: "rspeedy",
      experimental: false,
    };
  }

  return {
    framework: "unknown",
    label: "Unknown",
    evidence: "No supported Lynx framework marker found",
    buildSystem: "unknown",
    experimental: false,
  };
}
