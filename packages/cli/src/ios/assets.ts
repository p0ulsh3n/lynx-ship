import {
  copyFile,
  cp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert } from "@lynxship/contracts";
import { commandExists, runProcess } from "../process-runner.js";

async function copyIosOutput(source: string, target: string): Promise<boolean> {
  if (!existsSync(source)) return false;
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true, force: true });
  return true;
}

/**
 * Rspeedy leaves external resources beside the Lynx bundle. Xcode does not
 * know about those generated files, so copy the complete output into the
 * final app bundle after the native host has been compiled. This also makes
 * older LynxShip-generated iOS hosts behave correctly without editing their
 * Xcode project files.
 */
export async function syncIosRuntimeResources(
  root: string,
  appBundle: string,
): Promise<string[]> {
  const distRoot = join(root, "dist");
  const entries = await readdir(distRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const bundles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".lynx.bundle"))
    .map((entry) => entry.name);
  assert(
    bundles.length > 0,
    "LYNX_BUNDLE_MISSING",
    `No .lynx.bundle was found in ${distRoot}. Check the Rspeedy output configuration.`,
  );

  const copied: string[] = [];
  for (const name of [...bundles, "async", "static"]) {
    if (await copyIosOutput(join(distRoot, name), join(appBundle, name)))
      copied.push(name);
  }
  return copied;
}

async function findAppIconSet(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name === "AppIcon.appiconset") {
      if (existsSync(join(path, "Contents.json"))) return path;
    }
    if (
      entry.isDirectory() &&
      !entry.name.endsWith(".xcodeproj") &&
      !entry.name.endsWith(".xcworkspace")
    ) {
      const result = await findAppIconSet(path);
      if (result) return result;
    }
  }
  return undefined;
}

function pngDimensions(content: Buffer): { width: number; height: number } {
  assert(
    content.length >= 24 &&
      content.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    "IOS_APP_ICON_INVALID",
    "The iOS app icon must be a valid PNG file.",
  );
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
}

async function findConfiguredIosIcon(
  root: string,
  configured?: string,
  allowFallback = false,
): Promise<{ path: string; fallback: boolean } | undefined> {
  const candidates = [
    configured,
    "icon.png",
    "app-icon.png",
    "assets/icon.png",
    "assets/app-icon.png",
    "src/assets/icon.png",
    "src/assets/app-icon.png",
    "public/icon.png",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const path = resolve(root, candidate);
    if (existsSync(path)) return { path, fallback: false };
  }
  if (allowFallback) {
    const staticImages = join(root, "dist", "static", "image");
    const entries = await readdir(staticImages, { withFileTypes: true }).catch(
      () => [],
    );
    const logo = entries.find(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".png") &&
        /(?:lynx|logo|icon)/i.test(entry.name),
    );
    if (logo) return { path: join(staticImages, logo.name), fallback: true };
  }
  return undefined;
}

/**
 * Apply a project-owned 1024x1024 PNG to the generated or existing Xcode
 * AppIcon set. A missing icon is reported as a warning by the caller rather
 * than silently inventing product branding.
 */
export async function prepareIosAppIcon(
  root: string,
  configured?: string,
  options: { allowFallback?: boolean } = {},
): Promise<string | undefined> {
  const source = await findConfiguredIosIcon(
    root,
    configured,
    options.allowFallback,
  );
  const iconSet = await findAppIconSet(join(root, "ios"));
  if (!source || !iconSet) return undefined;
  const dimensions = pngDimensions(await readFile(source.path));
  const filename = "AppIcon.png";
  const destination = join(iconSet, filename);
  if (dimensions.width === 1024 && dimensions.height === 1024) {
    await copyFile(source.path, destination);
  } else {
    assert(
      source.fallback &&
        dimensions.width === dimensions.height &&
        dimensions.width >= 512,
      "IOS_APP_ICON_INVALID",
      `The iOS app icon must be exactly 1024x1024 PNG; received ${dimensions.width}x${dimensions.height} from ${source.path}.`,
    );
    assert(
      commandExists("sips"),
      "IOS_SIPS_REQUIRED",
      "The fallback Simulator icon needs Apple's sips tool. Install Xcode command-line tools, or provide a 1024x1024 icon.png.",
    );
    await runProcess(
      "sips",
      ["-z", "1024", "1024", source.path, "--out", destination],
      {
        cwd: root,
        quiet: true,
      },
    );
  }
  await writeFile(
    join(iconSet, "Contents.json"),
    `${JSON.stringify(
      {
        images: [
          {
            filename,
            idiom: "universal",
            platform: "ios",
            size: "1024x1024",
          },
        ],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return source.path;
}
