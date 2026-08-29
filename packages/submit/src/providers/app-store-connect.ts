import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { assert } from "@lynxship/contracts";
import type {
  AppStoreConnectCredentials,
  StoreArtifactInput,
  StoreSubmissionResult,
} from "./types.js";

export type { AppStoreConnectCredentials } from "./types.js";

function transporterCandidates(): string[] {
  if (process.env.LYNXSHIP_TRANSPORTER_PATH)
    return [process.env.LYNXSHIP_TRANSPORTER_PATH];
  if (process.platform === "win32")
    return [
      "C:\\Program Files (x86)\\itms\\iTMSTransporter.cmd",
      "iTMSTransporter.cmd",
    ];
  if (process.platform === "darwin")
    return [
      "/usr/local/itms/bin/iTMSTransporter",
      "/Applications/Transporter.app/Contents/itms/bin/iTMSTransporter",
      "iTMSTransporter",
    ];
  return ["/usr/local/itms/bin/iTMSTransporter", "iTMSTransporter"];
}

async function findTransporter(explicit?: string): Promise<string> {
  const candidates = explicit ? [explicit] : transporterCandidates();
  for (const candidate of candidates) {
    if (!candidate.includes("/") && !candidate.includes("\\")) return candidate;
    if (
      await access(candidate)
        .then(() => true)
        .catch(() => false)
    )
      return candidate;
  }
  throw new Error(
    "Apple Transporter was not found. Install Transporter and set LYNXSHIP_TRANSPORTER_PATH.",
  );
}

function runTransporter(
  executable: string,
  args: string[],
  cwd: string,
): Promise<{ output: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => resolve({ output, code: code ?? 1 }));
  });
}

export interface AppStoreConnectProviderOptions {
  transporterPath?: string;
  runner?: (
    executable: string,
    args: string[],
    cwd: string,
  ) => Promise<{ output: string; code: number }>;
}

export class AppStoreConnectApiProvider {
  constructor(
    readonly credentials: AppStoreConnectCredentials,
    readonly options: AppStoreConnectProviderOptions = {},
  ) {}

  async submit(input: StoreArtifactInput): Promise<StoreSubmissionResult> {
    assert(
      input.platform === "ios",
      "SUBMISSION_PLATFORM",
      "App Store Connect accepts iOS artifacts only",
    );
    assert(
      extname(input.path).toLowerCase() === ".ipa",
      "APPLE_ARTIFACT_INVALID",
      "App Store Connect submission requires an .ipa artifact",
    );
    await access(input.path);
    const transporter = await findTransporter(
      this.options.transporterPath ?? this.credentials.transporterPath,
    );
    const directory = await mkdtemp(join(tmpdir(), "lynxship-asc-"));
    const privateKeys = join(directory, "private_keys");
    await mkdir(privateKeys, { recursive: true });
    await writeFile(
      join(privateKeys, "AuthKey_" + this.credentials.apiKeyId + ".p8"),
      this.credentials.privateKey,
      { encoding: "utf8", mode: 0o600 },
    );
    try {
      const result = await (this.options.runner ?? runTransporter)(
        transporter,
        [
          "-m",
          "upload",
          "-apiIssuer",
          this.credentials.issuerId,
          "-apiKey",
          this.credentials.apiKeyId,
          "-assetFile",
          input.path,
        ],
        directory,
      );
      assert(
        result.code === 0,
        "APPLE_UPLOAD_FAILED",
        "Apple Transporter failed with exit code " +
          result.code +
          ": " +
          result.output.slice(-1200),
      );
      return {
        provider: "app-store-connect",
        remoteId: "asc_" + Date.now().toString(36),
        status: "uploaded",
        message: "iOS artifact uploaded to App Store Connect and is processing",
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
