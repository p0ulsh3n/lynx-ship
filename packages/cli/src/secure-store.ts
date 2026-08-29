import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commandExists } from "./process-runner.js";
import { assert } from "@lynxship/contracts";
import { globalLynxShipDirectory } from "./paths.js";
import type { StoredCredentials } from "./secure-store/types.js";
import {
  credentialFile,
  credentialValues,
  credentialsFromValues,
  protect,
  readKeychain,
  readSecretService,
  saveKeychain,
  saveSecretService,
  type EncryptedCredentials,
  unprotect,
} from "./secure-store/backends.js";

export type { StoredCredentials } from "./secure-store/types.js";

export function credentialStorageDescription(): string {
  if (process.platform === "win32") return "Windows DPAPI encrypted";
  if (process.platform === "darwin") return "macOS Keychain";
  if (commandExists("secret-tool")) return "Linux Secret Service";
  return "owner-only credential file";
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
          encrypted.platform === "linux-secret-service" ||
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
  if (process.platform === "linux") {
    const secretService = await readSecretService(root, global);
    if (secretService) return secretService;
  }
  const legacy = await readCredentialFile(credentialFile(root, global));
  if (
    process.platform === "darwin" &&
    (legacy.r2 !== undefined || legacy.android !== undefined)
  ) {
    await saveKeychain(root, legacy, global).catch(() => undefined);
  }
  if (
    process.platform === "linux" &&
    (legacy.r2 !== undefined ||
      legacy.android !== undefined ||
      legacy.googlePlay !== undefined ||
      legacy.appStoreConnect !== undefined) &&
    (await saveSecretService(root, legacy, global))
  ) {
    await unlink(credentialFile(root, global)).catch(() => undefined);
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
  if (process.platform === "linux") {
    if (await saveSecretService(root, credentials, global)) {
      await unlink(credentialFile(root, global)).catch(() => undefined);
      return;
    }
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
