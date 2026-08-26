const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const MANIFEST_VERSION = 1;

function isAbsoluteAny(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function safeRelative(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`@lynxship/expo ${label} must be a non-empty path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    isAbsoluteAny(value) ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "..") ||
    normalized.includes("\0")
  ) {
    throw new Error(
      `@lynxship/expo ${label} must be a portable relative path without '..'`,
    );
  }
  return normalized.replace(/^\.\//, "");
}

function destinationPath(root, relativePath) {
  const normalized = safeRelative(relativePath, "embeddedBundle");
  const destination = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, destination);
  if (
    relative === "" ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "@lynxship/expo embeddedBundle must stay in the asset root",
    );
  }
  return { normalized, destination };
}

async function collectFiles(directory, prefix = "") {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `@lynxship/expo refuses symbolic links in the Lynx output: ${relative}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute, relative)));
    } else if (entry.isFile()) {
      files.push({ absolute, relative: relative.replaceAll("\\", "/") });
    } else {
      throw new Error(
        `@lynxship/expo found an unsupported filesystem entry in the Lynx output: ${relative}`,
      );
    }
  }
  return files;
}

async function createBundlePlan(projectRoot, options = {}) {
  const bundlePath = options.bundlePath || "dist/main.lynx.bundle";
  if (typeof bundlePath !== "string" || bundlePath.trim() === "") {
    throw new Error("@lynxship/expo bundlePath must be a non-empty path");
  }
  const sourceBundle = path.resolve(projectRoot, bundlePath);
  const sourceDirectory = path.dirname(sourceBundle);
  const sourceStat = await fsp.stat(sourceBundle).catch(() => undefined);
  if (!sourceStat || !sourceStat.isFile() || sourceStat.size === 0) {
    throw new Error(
      `Lynx bundle not found or empty: ${sourceBundle}. Build Rspeedy first (for example: lynxship build --local), or set expo.plugins[@lynxship/expo].bundlePath to the generated .lynx.bundle.`,
    );
  }
  const embeddedBundle = safeRelative(
    options.embeddedBundle || "main.lynx.bundle",
    "embeddedBundle",
  );
  const files = await collectFiles(sourceDirectory);
  const plan = files.map((file) => ({
    ...file,
    destination:
      path.resolve(sourceDirectory, file.relative) === sourceBundle
        ? embeddedBundle
        : safeRelative(file.relative, "bundle output file"),
  }));
  const seen = new Set();
  for (const file of plan) {
    if (seen.has(file.destination)) {
      throw new Error(
        `@lynxship/expo found duplicate embedded asset path: ${file.destination}`,
      );
    }
    seen.add(file.destination);
  }
  return {
    sourceBundle,
    sourceDirectory,
    bundlePath,
    embeddedBundle,
    files: plan,
  };
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(await fsp.readFile(file));
  return hash.digest("hex");
}

async function readManifest(file) {
  try {
    const value = JSON.parse(await fsp.readFile(file, "utf8"));
    if (value.version !== MANIFEST_VERSION || !Array.isArray(value.files)) {
      return { files: [] };
    }
    return value;
  } catch {
    return { files: [] };
  }
}

function manifestPaths(manifest) {
  return new Set(
    manifest.files
      .map((file) => file && file.path)
      .filter((file) => typeof file === "string")
      .map((file) => safeRelative(file, "managed asset path")),
  );
}

async function syncBundleDirectory({
  projectRoot,
  plan,
  destinationRoot,
  manifestPath,
  platform,
}) {
  await fsp.mkdir(destinationRoot, { recursive: true });
  const previous = await readManifest(manifestPath);
  const previouslyManaged = manifestPaths(previous);
  const desired = new Set(plan.files.map((file) => file.destination));

  for (const file of plan.files) {
    const { destination } = destinationPath(destinationRoot, file.destination);
    const existing = await fsp.lstat(destination).catch(() => undefined);
    if (existing && !previouslyManaged.has(file.destination)) {
      throw new Error(
        `@lynxship/expo will not overwrite an unmanaged ${platform} asset: ${destination}. Choose another embeddedBundle path or remove the conflicting file yourself.`,
      );
    }
    if (existing && !existing.isFile()) {
      throw new Error(
        `@lynxship/expo cannot replace a non-file ${platform} asset: ${destination}`,
      );
    }
  }

  for (const stale of previouslyManaged) {
    if (desired.has(stale)) continue;
    const { destination } = destinationPath(destinationRoot, stale);
    const existing = await fsp.lstat(destination).catch(() => undefined);
    if (existing?.isFile()) await fsp.rm(destination);
  }

  const manifestFiles = [];
  for (const file of plan.files) {
    const { destination } = destinationPath(destinationRoot, file.destination);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(file.absolute, destination);
    const stat = await fsp.stat(destination);
    manifestFiles.push({
      path: file.destination,
      size: stat.size,
      sha256: await sha256File(destination),
    });
  }

  await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
  const source = path
    .relative(projectRoot, plan.sourceDirectory)
    .replaceAll("\\", "/");
  await fsp.writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: MANIFEST_VERSION,
        platform,
        source: source || ".",
        bundlePath: plan.bundlePath,
        embeddedBundle: plan.embeddedBundle,
        files: manifestFiles,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return {
    platform,
    sourceBundle: plan.sourceBundle,
    destinationRoot,
    manifestPath,
    files: manifestFiles,
  };
}

async function syncLynxAssets(projectRoot, options = {}) {
  const plan = await createBundlePlan(projectRoot, options);
  const platform = options.platform;
  if (platform === "android") {
    const destinationRoot = path.join(
      projectRoot,
      "android",
      "app",
      "src",
      "main",
      "assets",
    );
    if (!fs.existsSync(path.join(projectRoot, "android"))) {
      throw new Error(
        "Android native project is missing. Run `npx expo prebuild --platform android` before syncing the Lynx bundle.",
      );
    }
    return syncBundleDirectory({
      projectRoot,
      plan,
      destinationRoot,
      manifestPath: path.join(projectRoot, "android", ".lynxship-assets.json"),
      platform,
    });
  }
  if (platform === "ios") {
    const iosSourceRoot = options.iosSourceRoot;
    if (!iosSourceRoot) {
      throw new Error(
        "iOS native source root is unavailable. Run `npx expo prebuild --platform ios` before syncing the Lynx bundle.",
      );
    }
    return syncBundleDirectory({
      projectRoot,
      plan,
      destinationRoot: path.join(iosSourceRoot, "LynxShipAssets"),
      manifestPath: path.join(projectRoot, "ios", ".lynxship-assets.json"),
      platform,
    });
  }
  throw new Error(`@lynxship/expo does not support asset sync for ${platform}`);
}

module.exports = {
  createBundlePlan,
  syncBundleDirectory,
  syncLynxAssets,
};
