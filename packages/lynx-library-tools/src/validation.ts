import { access, readFile, realpath, readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  LYNX_LIBRARY_MANIFEST,
  LYNX_LIBRARY_PLATFORMS,
  LynxLibraryValidationError,
  type LynxLibraryIssue,
  type LynxLibraryManifest,
  type LynxLibraryPlatform,
  type LynxLibraryInspection,
} from "./contracts.js";
import { inspectPackageJson } from "./package-validation.js";

function issue(
  code: LynxLibraryIssue["code"],
  message: string,
  path?: string,
): LynxLibraryIssue {
  return { code, message, ...(path ? { path } : {}) };
}

function inside(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === "" ||
    (!relativePath.startsWith(".." + sep) && !isAbsolute(relativePath))
  );
}

function platformRoot(
  root: string,
  platform: LynxLibraryPlatform,
  definition: Record<string, unknown>,
): string {
  const configured =
    platform === "harmony"
      ? definition.packageDir
      : platform === "lynxtron"
        ? definition.path
        : definition.sourceDir;
  const fallback = platform === "lynxtron" ? "lynxtron" : platform;
  return resolve(
    root,
    typeof configured === "string" && configured ? configured : fallback,
  );
}

function parseManifest(text: string): LynxLibraryManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as LynxLibraryManifest;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isWithinRealRoot(
  root: string,
  candidate: string,
): Promise<boolean> {
  try {
    return inside(await realpath(root), await realpath(candidate));
  } catch {
    return false;
  }
}

async function containsPodspec(source: string): Promise<boolean> {
  try {
    const entries = await readdir(source, {
      withFileTypes: true,
      recursive: true,
    });
    return entries.some(
      (entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith(".podspec"),
    );
  } catch {
    return false;
  }
}

const HARMONY_HAR_FILES = [
  "hvigorfile.ts",
  "oh-package.json5",
  "build-profile.json5",
  "src/main/module.json5",
] as const;

async function inspectHarmonyHar(
  source: string,
  issues: LynxLibraryIssue[],
): Promise<void> {
  for (const relativePath of HARMONY_HAR_FILES) {
    const path = resolve(source, relativePath);
    try {
      await access(path);
    } catch {
      issues.push(
        issue(
          "harmony-package-missing",
          `HarmonyOS source HAR is missing ${relativePath}`,
          path,
        ),
      );
    }
  }

  const packageManifest = resolve(source, "oh-package.json5");
  try {
    const text = await readFile(packageManifest, "utf8");
    const main = text.match(/['\"]?main['\"]?\s*:\s*['\"]([^'\"]+)['\"]/)?.[1];
    if (main) {
      const entry = resolve(source, main);
      if (!(await isWithinRealRoot(source, entry))) {
        issues.push(
          issue(
            "path-invalid",
            `HarmonyOS package entry ${main} resolves outside the source HAR`,
            entry,
          ),
        );
      } else {
        try {
          await access(entry);
        } catch {
          issues.push(
            issue(
              "harmony-package-missing",
              `HarmonyOS package entry ${main} does not exist`,
              entry,
            ),
          );
        }
      }
    } else {
      try {
        await access(resolve(source, "Index.ets"));
      } catch {
        issues.push(
          issue(
            "harmony-package-missing",
            "HarmonyOS source HAR needs Index.ets or an oh-package.json5 main entry",
            source,
          ),
        );
      }
    }
  } catch {
    // The missing manifest is already reported by the required-file loop.
  }
}

async function inspectPlatform(
  root: string,
  platform: LynxLibraryPlatform,
  definition: unknown,
): Promise<{
  issues: LynxLibraryIssue[];
  stats?: { size: number; mtimeMs: number };
}> {
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  )
    return {
      issues: [
        issue(
          "platform-invalid",
          `${platform} platform definition must be an object`,
        ),
      ],
    };
  const object = definition as Record<string, unknown>;
  const source = platformRoot(root, platform, object);
  const issues: LynxLibraryIssue[] = [];
  if (!inside(root, source)) {
    issues.push(
      issue(
        "path-invalid",
        `${platform} native directory escapes the library root`,
        source,
      ),
    );
    return { issues };
  }
  if (!(await isDirectory(source))) {
    issues.push(
      issue("path-missing", `${platform} native directory is missing`, source),
    );
    return { issues };
  }
  if (!(await isWithinRealRoot(root, source))) {
    issues.push(
      issue(
        "path-invalid",
        `${platform} native directory resolves outside the library root`,
        source,
      ),
    );
    return { issues };
  }
  const stats = await stat(source);
  if (platform === "harmony") await inspectHarmonyHar(source, issues);
  if (
    platform === "android" &&
    (typeof object.packageName !== "string" ||
      !/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/.test(object.packageName))
  )
    issues.push(
      issue(
        "android-package-missing",
        "platforms.android.packageName is required",
      ),
    );
  if (platform === "ios") {
    if (object.podspecPath === undefined) {
      if (!(await containsPodspec(source)))
        issues.push(
          issue(
            "ios-podspec-missing",
            "iOS source directory must contain a .podspec when podspecPath is omitted",
            source,
          ),
        );
    } else if (
      typeof object.podspecPath !== "string" ||
      !object.podspecPath.trim()
    ) {
      issues.push(
        issue(
          "ios-podspec-missing",
          "platforms.ios.podspecPath must be a non-empty string",
        ),
      );
    } else {
      const podspec = resolve(root, object.podspecPath);
      if (!inside(root, podspec))
        issues.push(
          issue(
            "path-invalid",
            "iOS podspec escapes the library root",
            podspec,
          ),
        );
      else if (!(await isWithinRealRoot(root, podspec))) {
        issues.push(
          issue(
            "path-invalid",
            "iOS podspec resolves outside the library root",
            podspec,
          ),
        );
      } else {
        try {
          await access(podspec);
        } catch {
          issues.push(
            issue("ios-podspec-missing", "iOS podspec does not exist", podspec),
          );
        }
      }
    }
  }
  if (platform === "lynxtron") {
    if (typeof object.path !== "string" || !object.path.trim())
      issues.push(
        issue(
          "lynxtron-path-missing",
          "platforms.lynxtron.path must be a non-empty artifact root",
        ),
      );
  }
  return { issues, stats: { size: stats.size, mtimeMs: stats.mtimeMs } };
}

export async function inspectLynxLibrary(
  root: string,
): Promise<LynxLibraryInspection> {
  const libraryRoot = resolve(root);
  const packageInspection = await inspectPackageJson(libraryRoot);
  const packageJson = packageInspection.packageJson;
  const manifestPath = resolve(libraryRoot, LYNX_LIBRARY_MANIFEST);
  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    return {
      root: libraryRoot,
      packageJson,
      manifestPath,
      manifest: null,
      platforms: [],
      issues: [
        ...packageInspection.issues,
        issue(
          "manifest-missing",
          `${LYNX_LIBRARY_MANIFEST} is missing`,
          manifestPath,
        ),
      ],
      sourceStats: {},
    };
  }
  const manifest = parseManifest(text);
  if (!manifest)
    return {
      root: libraryRoot,
      packageJson,
      manifestPath,
      manifest: null,
      platforms: [],
      issues: [
        ...packageInspection.issues,
        issue(
          "manifest-invalid-json",
          `${LYNX_LIBRARY_MANIFEST} must contain a JSON object`,
          manifestPath,
        ),
      ],
      sourceStats: {},
    };
  const declared = manifest.platforms;
  if (
    declared !== undefined &&
    (!declared || typeof declared !== "object" || Array.isArray(declared))
  )
    return {
      root: libraryRoot,
      packageJson,
      manifestPath,
      manifest,
      platforms: [],
      issues: [
        ...packageInspection.issues,
        issue("manifest-invalid-shape", "platforms must be an object"),
      ],
      sourceStats: {},
    };
  const platforms = LYNX_LIBRARY_PLATFORMS.filter((candidate) =>
    Object.prototype.hasOwnProperty.call(declared ?? {}, candidate),
  );
  const unknownPlatforms = Object.keys(declared ?? {}).filter(
    (candidate) =>
      !(LYNX_LIBRARY_PLATFORMS as readonly string[]).includes(candidate),
  );
  const results = await Promise.all(
    platforms.map(
      async (platform) =>
        [
          platform,
          await inspectPlatform(libraryRoot, platform, declared?.[platform]),
        ] as const,
    ),
  );
  const issues = [
    ...packageInspection.issues,
    ...unknownPlatforms.map((platform) =>
      issue(
        "platform-invalid",
        `Unsupported Lynx library platform ${platform}`,
      ),
    ),
    ...results.flatMap(([, result]) => result.issues),
  ];
  const sourceStats: LynxLibraryInspection["sourceStats"] = {};
  for (const [platform, result] of results)
    if (result.stats) sourceStats[platform] = result.stats;
  return {
    root: libraryRoot,
    packageJson,
    manifestPath,
    manifest,
    platforms,
    issues,
    sourceStats,
  };
}

export async function validateLynxLibrary(
  root: string,
): Promise<LynxLibraryInspection> {
  const inspection = await inspectLynxLibrary(root);
  if (inspection.issues.length > 0)
    throw new LynxLibraryValidationError(inspection.issues);
  return inspection;
}
