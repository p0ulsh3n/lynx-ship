import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { assert } from "@lynxship/contracts";
import { globalLynxShipDirectory } from "../paths.js";
import { commandExists } from "../process-runner.js";
import type { StoredCredentials } from "./types.js";

export interface EncryptedCredentials {
  version: 1;
  platform:
    | "windows-dpapi"
    | "macos-keychain"
    | "linux-secret-service"
    | "file-mode-600";
  values: Record<string, string>;
}

const fileName = ".credentials.dpapi.json";
const keychainService = "com.lynxship.cli.credentials";

export function credentialFile(root: string, global = false): string {
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

export async function protect(value: string): Promise<string> {
  if (process.platform !== "win32") return value;
  return runPowerShell(
    "Import-Module Microsoft.PowerShell.Security; $input | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString",
    value,
  );
}

export async function unprotect(value: string): Promise<string> {
  if (process.platform !== "win32") return value;
  return runPowerShell(
    "Import-Module Microsoft.PowerShell.Security; $cipher = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $cipher; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }",
    value,
  );
}

export function runSecurity(args: string[]): Promise<string> {
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

export function runSecretTool(args: string[], input = ""): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("secret-tool", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (error += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0)
        reject(
          new Error(error.trim() || "Linux Secret Service operation failed"),
        );
      else resolveOutput(output.trim());
    });
    child.stdin.end(input);
  });
}

export function keychainAccount(root: string, global: boolean): string {
  return global ? "global" : `project:${resolve(root)}`;
}

export function secretServiceAccount(root: string, global: boolean): string {
  return keychainAccount(root, global);
}

export function credentialValues(
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

export function credentialsFromValues(
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

export async function readKeychain(
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

export async function saveKeychain(
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

export async function readSecretService(
  root: string,
  global: boolean,
): Promise<StoredCredentials | undefined> {
  if (process.platform !== "linux" || !commandExists("secret-tool"))
    return undefined;
  try {
    const value = await runSecretTool([
      "lookup",
      "application",
      keychainService,
      "account",
      secretServiceAccount(root, global),
    ]);
    if (!value) return undefined;
    const stored = JSON.parse(value) as EncryptedCredentials;
    assert(
      stored.version === 1 && stored.platform === "linux-secret-service",
      "CLI_CREDENTIALS_INVALID",
      "Unsupported LynxShip Linux Secret Service record",
    );
    return credentialsFromValues(stored.values);
  } catch {
    return undefined;
  }
}

export async function saveSecretService(
  root: string,
  credentials: StoredCredentials,
  global: boolean,
): Promise<boolean> {
  if (process.platform !== "linux" || !commandExists("secret-tool"))
    return false;
  const record: EncryptedCredentials = {
    version: 1,
    platform: "linux-secret-service",
    values: credentialValues(credentials),
  };
  try {
    await runSecretTool(
      [
        "store",
        "--label",
        "LynxShip CLI credentials",
        "application",
        keychainService,
        "account",
        secretServiceAccount(root, global),
      ],
      JSON.stringify(record),
    );
    return true;
  } catch {
    return false;
  }
}
