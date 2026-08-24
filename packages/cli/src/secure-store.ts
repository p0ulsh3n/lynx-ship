import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { assert } from "@lynxship/contracts";
import { globalLynxShipDirectory } from "./paths.js";

export interface StoredCredentials {
  r2?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  android?: {
    keystorePath: string;
    keyAlias: string;
    keystorePassword: string;
    keyPassword: string;
  };
  googlePlay?: {
    serviceAccountJson: string;
    applicationId: string;
    track: string;
    releaseStatus: "draft" | "completed" | "inProgress" | "halted";
  };
  appStoreConnect?: {
    apiKeyId: string;
    issuerId: string;
    privateKey: string;
    bundleIdentifier: string;
    ascAppId?: string;
    transporterPath?: string;
  };
}

export function credentialStorageDescription(): string {
  if (process.platform === "win32") return "Windows DPAPI encrypted";
  if (process.platform === "darwin") return "macOS Keychain";
  return "owner-only credential file";
}

interface EncryptedCredentials {
  version: 1;
  platform: "windows-dpapi" | "macos-keychain" | "file-mode-600";
  values: Record<string, string>;
}

const fileName = ".credentials.dpapi.json";
const keychainService = "com.lynxship.cli.credentials";

function credentialFile(root: string, global = false): string {
  return join(
    global ? globalLynxShipDirectory() : join(root, ".lynxship"),
    fileName,
  );
}

function runPowerShell(command: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PSModulePath: [
            `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\Modules`,
            `${process.env.ProgramFiles ?? "C:\\Program Files"}\\WindowsPowerShell\\Modules`,
          ].join(";"),
        },
      },
    );
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (error += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0)
        reject(new Error(error.trim() || "Windows secure storage failed"));
      else resolve(output.trim());
    });
    child.stdin.end(input);
  });
}

async function protect(value: string): Promise<string> {
  if (process.platform !== "win32") return value;
  return runPowerShell(
    "Import-Module Microsoft.PowerShell.Security; $input | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString",
    value,
  );
}

async function unprotect(value: string): Promise<string> {
  if (process.platform !== "win32") return value;
  return runPowerShell(
    "Import-Module Microsoft.PowerShell.Security; $cipher = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $cipher; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }",
    value,
  );
}

function runSecurity(args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("security", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (error += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0)
        reject(new Error(error.trim() || "macOS Keychain operation failed"));
      else resolveOutput(output.trim());
    });
    child.stdin.end();
  });
}

function keychainAccount(root: string, global: boolean): string {
  return global ? "global" : `project:${resolve(root)}`;
}

function credentialValues(
  credentials: StoredCredentials,
): Record<string, string> {
  const values: Record<string, string> = {};
  if (credentials.r2) {
    values.r2AccessKeyId = credentials.r2.accessKeyId;
    values.r2SecretAccessKey = credentials.r2.secretAccessKey;
  }
  if (credentials.android) {
    values.androidKeystorePath = credentials.android.keystorePath;
    values.androidKeyAlias = credentials.android.keyAlias;
    values.androidKeystorePassword = credentials.android.keystorePassword;
    values.androidKeyPassword = credentials.android.keyPassword;
  }
  if (credentials.googlePlay) {
    values.googlePlayServiceAccountJson =
      credentials.googlePlay.serviceAccountJson;
    values.googlePlayApplicationId = credentials.googlePlay.applicationId;
    values.googlePlayTrack = credentials.googlePlay.track;
    values.googlePlayReleaseStatus = credentials.googlePlay.releaseStatus;
  }
  if (credentials.appStoreConnect) {
    values.ascApiKeyId = credentials.appStoreConnect.apiKeyId;
    values.ascIssuerId = credentials.appStoreConnect.issuerId;
    values.ascPrivateKey = credentials.appStoreConnect.privateKey;
    values.ascBundleIdentifier = credentials.appStoreConnect.bundleIdentifier;
    values.ascAppId = credentials.appStoreConnect.ascAppId ?? "";
    values.ascTransporterPath =
      credentials.appStoreConnect.transporterPath ?? "";
  }
  return values;
}

function credentialsFromValues(
  values: Record<string, string>,
): StoredCredentials {
  return {
    r2:
      values.r2AccessKeyId && values.r2SecretAccessKey
        ? {
            accessKeyId: values.r2AccessKeyId,
            secretAccessKey: values.r2SecretAccessKey,
          }
        : undefined,
    android:
      values.androidKeystorePath &&
      values.androidKeyAlias &&
      values.androidKeystorePassword &&
      values.androidKeyPassword
        ? {
            keystorePath: values.androidKeystorePath,
            keyAlias: values.androidKeyAlias,
            keystorePassword: values.androidKeystorePassword,
            keyPassword: values.androidKeyPassword,
          }
        : undefined,
    googlePlay:
      values.googlePlayServiceAccountJson &&
      values.googlePlayApplicationId &&
      values.googlePlayTrack &&
      values.googlePlayReleaseStatus
        ? {
            serviceAccountJson: values.googlePlayServiceAccountJson,
            applicationId: values.googlePlayApplicationId,
            track: values.googlePlayTrack,
            releaseStatus: values.googlePlayReleaseStatus as
              | "draft"
              | "completed"
              | "inProgress"
              | "halted",
          }
        : undefined,
    appStoreConnect:
      values.ascApiKeyId &&
      values.ascIssuerId &&
      values.ascPrivateKey &&
      values.ascBundleIdentifier
        ? {
            apiKeyId: values.ascApiKeyId,
            issuerId: values.ascIssuerId,
            privateKey: values.ascPrivateKey,
            bundleIdentifier: values.ascBundleIdentifier,
            ascAppId: values.ascAppId || undefined,
            transporterPath: values.ascTransporterPath || undefined,
          }
        : undefined,
  };
}

async function readKeychain(
  root: string,
  global: boolean,
): Promise<StoredCredentials | undefined> {
  try {
    const value = await runSecurity([
      "find-generic-password",
      "-a",
      keychainAccount(root, global),
      "-s",
      keychainService,
      "-w",
    ]);
    const stored = JSON.parse(value) as EncryptedCredentials;
    assert(
      stored.version === 1 && stored.platform === "macos-keychain",
      "CLI_CREDENTIALS_INVALID",
      "Unsupported LynxShip Keychain record",
    );
    return credentialsFromValues(stored.values);
  } catch {
    return undefined;
  }
}

async function saveKeychain(
  root: string,
  credentials: StoredCredentials,
  global: boolean,
): Promise<void> {
  const record: EncryptedCredentials = {
    version: 1,
    platform: "macos-keychain",
    values: credentialValues(credentials),
  };
  await runSecurity([
    "add-generic-password",
    "-U",
    "-a",
    keychainAccount(root, global),
    "-s",
    keychainService,
    "-w",
    JSON.stringify(record),
  ]);
  await unlink(credentialFile(root, global)).catch(() => undefined);
}

function mergeCredentials(
  global: StoredCredentials,
  project: StoredCredentials,
): StoredCredentials {
  return {
    r2: project.r2 ?? global.r2,
    android: project.android ?? global.android,
    googlePlay: project.googlePlay ?? global.googlePlay,
    appStoreConnect: project.appStoreConnect ?? global.appStoreConnect,
  };
}

async function readCredentialFile(file: string): Promise<StoredCredentials> {
  try {
    const encrypted = JSON.parse(
      await readFile(file, "utf8"),
    ) as EncryptedCredentials;
    assert(
      encrypted.version === 1 &&
        (encrypted.platform === "windows-dpapi" ||
          encrypted.platform === "macos-keychain" ||
          encrypted.platform === "file-mode-600"),
      "CLI_CREDENTIALS_INVALID",
      "Unsupported LynxShip credential store",
    );
    const values = Object.fromEntries(
      await Promise.all(
        Object.entries(encrypted.values).map(async ([key, value]) => [
          key,
          encrypted.platform === "windows-dpapi"
            ? await unprotect(value)
            : value,
        ]),
      ),
    );
    return credentialsFromValues(values);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function readCredentialStore(
  root: string,
  global: boolean,
): Promise<StoredCredentials> {
  if (process.platform === "darwin") {
    const keychain = await readKeychain(root, global);
    if (keychain) return keychain;
  }
  const legacy = await readCredentialFile(credentialFile(root, global));
  if (
    process.platform === "darwin" &&
    (legacy.r2 !== undefined || legacy.android !== undefined)
  ) {
    await saveKeychain(root, legacy, global).catch(() => undefined);
  }
  return legacy;
}

export async function loadCredentials(
  root: string,
): Promise<StoredCredentials> {
  const [global, project] = await Promise.all([
    readCredentialStore(root, true),
    readCredentialStore(root, false),
  ]);
  return mergeCredentials(global, project);
}

export async function saveCredentials(
  root: string,
  credentials: StoredCredentials,
  options: { global?: boolean } = {},
): Promise<void> {
  const global = options.global ?? false;
  if (process.platform === "darwin") {
    await saveKeychain(root, credentials, global);
    return;
  }
  const values = credentialValues(credentials);
  const encrypted: EncryptedCredentials = {
    version: 1,
    platform: process.platform === "win32" ? "windows-dpapi" : "file-mode-600",
    values: Object.fromEntries(
      await Promise.all(
        Object.entries(values).map(async ([key, value]) => [
          key,
          await protect(value),
        ]),
      ),
    ),
  };
  const directory = global
    ? globalLynxShipDirectory()
    : join(root, ".lynxship");
  await mkdir(directory, { recursive: true });
  const file = credentialFile(root, global);
  await writeFile(file, `${JSON.stringify(encrypted, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") await chmod(file, 0o600);
}
