import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { captureProcess, commandExists } from "./process-runner.js";

type DesktopBuildConfiguration = {
  win?: {
    certificateFile?: string;
    certificateSubjectName?: string;
    signAndEditExecutable?: boolean;
  };
  mac?: { identity?: string; certificateFile?: string };
};

interface DesktopManifest {
  build?: DesktopBuildConfiguration;
}

export type DesktopSigningStatus =
  | "configured"
  | "missing"
  | "disabled"
  | "unknown"
  | "not-required";

export interface DesktopSigningCheck {
  status: DesktopSigningStatus;
  value: string;
  fix: string;
}

export interface DesktopArtifactSignature {
  signed: boolean;
  status: "signed" | "unsigned" | "unavailable" | "not-required";
  detail: string;
}

async function manifest(root: string): Promise<DesktopManifest> {
  try {
    return JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as DesktopManifest;
  } catch {
    return {};
  }
}

function hasConfiguredCertificate(
  configuration: DesktopBuildConfiguration,
): "configured" | "missing" {
  if (process.platform === "win32") {
    const windows = configuration.win;
    if (windows?.signAndEditExecutable === false) return "missing";
    if (
      process.env.WIN_CSC_LINK ||
      process.env.CSC_LINK ||
      windows?.certificateFile ||
      windows?.certificateSubjectName
    )
      return "configured";
    return "missing";
  }
  if (process.platform === "darwin") {
    const mac = configuration.mac;
    if (
      process.env.CSC_LINK ||
      process.env.CSC_NAME ||
      mac?.identity ||
      mac?.certificateFile
    )
      return "configured";
    return "missing";
  }
  return "configured";
}

export async function inspectDesktopSigning(
  root: string,
): Promise<DesktopSigningCheck> {
  if (process.platform !== "win32" && process.platform !== "darwin")
    return {
      status: "not-required",
      value: `${process.platform} desktop packaging does not use Authenticode or Apple code signing`,
      fix: "Use the target operating system's distribution signing policy before publishing.",
    };

  const configuration = (await manifest(root)).build ?? {};
  if (
    process.platform === "win32" &&
    configuration.win?.signAndEditExecutable === false
  )
    return {
      status: "disabled",
      value: "Windows executable signing is disabled in Electron Builder",
      fix: "Remove build.win.signAndEditExecutable=false and configure WIN_CSC_LINK/CSC_KEY_PASSWORD or a certificateSubjectName.",
    };

  const configured = hasConfiguredCertificate(configuration);
  if (configured === "configured")
    return {
      status: "configured",
      value:
        process.platform === "win32"
          ? "Windows Authenticode certificate input detected"
          : "Apple desktop signing input detected",
      fix: "The final artifact signature will be verified after packaging.",
    };

  return {
    status: process.platform === "darwin" ? "unknown" : "missing",
    value:
      process.platform === "win32"
        ? "Windows Authenticode certificate not configured"
        : "Apple desktop signing identity not explicitly configured",
    fix:
      process.platform === "win32"
        ? "Configure WIN_CSC_LINK or CSC_LINK and CSC_KEY_PASSWORD, or set build.win.certificateSubjectName, then rerun lynxship doctor --platform desktop."
        : "Configure CSC_LINK/CSC_NAME or the mac.identity in Electron Builder; the final build must pass codesign verification.",
  };
}

async function verifyWindowsArtifact(
  artifactPath: string,
): Promise<DesktopArtifactSignature> {
  const windowsPowerShell = process.env.SystemRoot
    ? join(
        process.env.SystemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      )
    : "powershell.exe";
  const powershell = commandExists(windowsPowerShell)
    ? windowsPowerShell
    : commandExists("powershell.exe")
      ? "powershell.exe"
      : commandExists("pwsh")
        ? "pwsh"
        : undefined;
  if (!powershell)
    return {
      signed: false,
      status: "unavailable",
      detail: "PowerShell is unavailable; Authenticode could not be verified.",
    };

  const result = await captureProcess(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "if (-not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) { Write-Output 'UNAVAILABLE'; exit 2 }; $signature = Get-AuthenticodeSignature -LiteralPath $env:LYNXSHIP_ARTIFACT_PATH; Write-Output $signature.Status; if ($signature.Status -ne 'Valid') { exit 1 }",
    ],
    {
      cwd: dirname(artifactPath),
      env: {
        ...process.env,
        LYNXSHIP_ARTIFACT_PATH: artifactPath,
        ...(process.env.SystemRoot
          ? {
              PSModulePath: [
                join(
                  process.env.SystemRoot,
                  "System32",
                  "WindowsPowerShell",
                  "v1.0",
                  "Modules",
                ),
                process.env.ProgramFiles
                  ? join(
                      process.env.ProgramFiles,
                      "WindowsPowerShell",
                      "Modules",
                    )
                  : undefined,
              ]
                .filter((value): value is string => Boolean(value))
                .join(";"),
            }
          : {}),
      },
    },
  );
  const detail = (result.stdout || result.stderr).trim().split(/\r?\n/).at(-1);
  if (result.code === 0)
    return { signed: true, status: "signed", detail: detail || "Valid" };
  if (
    result.code === 2 ||
    /(?:couldnotautoload|commandnotfound|not recognized|unavailable)/i.test(
      detail ?? "",
    )
  )
    return {
      signed: false,
      status: "unavailable",
      detail: "PowerShell Authenticode support is unavailable on this machine.",
    };
  return {
    signed: false,
    status: "unsigned",
    detail: detail || "Authenticode signature is not valid.",
  };
}

async function verifyMacArtifact(
  artifactPath: string,
): Promise<DesktopArtifactSignature> {
  const extension = extname(artifactPath).toLowerCase();
  let appPath = extension === ".app" ? artifactPath : undefined;
  let mountPath: string | undefined;
  try {
    if (extension === ".dmg") {
      if (!commandExists("hdiutil"))
        return {
          signed: false,
          status: "unavailable",
          detail:
            "hdiutil is unavailable; the DMG application could not be inspected.",
        };
      mountPath = await mkdtemp(join(tmpdir(), "lynxship-dmg-"));
      const mounted = await captureProcess(
        "hdiutil",
        [
          "attach",
          artifactPath,
          "-nobrowse",
          "-readonly",
          "-mountpoint",
          mountPath,
        ],
        { cwd: dirname(artifactPath) },
      );
      if (mounted.code !== 0)
        return {
          signed: false,
          status: "unsigned",
          detail:
            (mounted.stderr || mounted.stdout).trim() ||
            "The DMG could not be mounted for signature verification.",
        };
      const entries = await readdir(mountPath, { withFileTypes: true });
      const app = entries.find(
        (entry) =>
          entry.isDirectory() && entry.name.toLowerCase().endsWith(".app"),
      );
      appPath = app ? join(mountPath, app.name) : undefined;
    }
    if (!appPath || !commandExists("codesign"))
      return {
        signed: false,
        status: "unavailable",
        detail:
          "No verifiable macOS .app bundle was found in the Desktop artifact.",
      };
    const result = await captureProcess(
      "codesign",
      ["--verify", "--deep", "--strict", appPath],
      { cwd: dirname(appPath) },
    );
    return result.code === 0
      ? {
          signed: true,
          status: "signed",
          detail: "codesign verification passed",
        }
      : {
          signed: false,
          status: "unsigned",
          detail:
            (result.stderr || result.stdout).trim() ||
            "codesign verification failed",
        };
  } finally {
    if (mountPath) {
      await captureProcess("hdiutil", ["detach", mountPath, "-force"], {
        cwd: dirname(artifactPath),
      }).catch(() => undefined);
      await rm(mountPath, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

export async function verifyDesktopArtifactSignature(
  artifactPath: string,
): Promise<DesktopArtifactSignature> {
  const absoluteArtifact = resolve(artifactPath);
  if (
    process.platform === "win32" &&
    extname(absoluteArtifact).toLowerCase() === ".exe"
  )
    return verifyWindowsArtifact(absoluteArtifact);
  if (process.platform === "darwin") return verifyMacArtifact(absoluteArtifact);
  return {
    signed: false,
    status: "not-required",
    detail:
      "No platform code-signature verification is required for this target.",
  };
}
