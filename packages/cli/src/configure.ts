import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { prompt, secret } from "./prompt.js";
import {
  defaultEndpoint,
  verifyR2,
  writeR2Config,
  type R2Config,
} from "./r2.js";
import {
  loadCredentials,
  saveCredentials,
  type StoredCredentials,
} from "./secure-store.js";
import { globalLynxShipDirectory } from "./paths.js";

export async function configureR2(root: string): Promise<R2Config> {
  const accountId = await prompt(
    "Cloudflare account ID",
    process.env.CLOUDFLARE_ACCOUNT_ID,
  );
  const bucket = await prompt("R2 bucket name", "lynxship-artifacts");
  const accessKeyId = await secret("R2 access key ID");
  const secretAccessKey = await secret("R2 secret access key");
  const expiresIn = Number(
    await prompt("Download link lifetime in seconds", "86400"),
  );
  const config: R2Config = {
    accountId,
    bucket,
    endpoint: defaultEndpoint(accountId),
    expiresIn,
  };
  const credentials = { accessKeyId, secretAccessKey };
  await verifyR2(config, credentials);
  const existing = await loadCredentials(root);
  await writeR2Config(root, config, { global: true });
  await saveCredentials(
    root,
    { ...existing, r2: credentials },
    { global: true },
  );
  return config;
}

interface AndroidConfigurationResult {
  keystorePath: string;
  generated: boolean;
}

export async function configureGooglePlay(root: string): Promise<void> {
  const existing = await loadCredentials(root);
  const serviceAccountPath = await prompt("Google service account JSON path");
  const serviceAccountJson = await readFile(serviceAccountPath, "utf8");
  const parsed = JSON.parse(serviceAccountJson) as {
    client_email?: string;
    private_key?: string;
  };
  if (!parsed.client_email || !parsed.private_key)
    throw new Error(
      "Google service account JSON must contain client_email and private_key",
    );
  const applicationId = await prompt(
    "Android application ID",
    existing.googlePlay?.applicationId,
  );
  const track = await prompt(
    "Google Play track",
    existing.googlePlay?.track ?? "internal",
  );
  const releaseStatus = await prompt(
    "Release status",
    existing.googlePlay?.releaseStatus ?? "draft",
  );
  if (!["draft", "completed", "inProgress", "halted"].includes(releaseStatus))
    throw new Error(
      "Release status must be draft, completed, inProgress or halted",
    );
  await saveCredentials(
    root,
    {
      ...existing,
      googlePlay: {
        serviceAccountJson,
        applicationId,
        track,
        releaseStatus: releaseStatus as
          | "draft"
          | "completed"
          | "inProgress"
          | "halted",
      },
    },
    { global: true },
  );
}

export async function configureAppStoreConnect(root: string): Promise<void> {
  const existing = await loadCredentials(root);
  const apiKeyId = await prompt(
    "App Store Connect API key ID",
    existing.appStoreConnect?.apiKeyId,
  );
  const issuerId = await prompt(
    "App Store Connect issuer ID",
    existing.appStoreConnect?.issuerId,
  );
  const bundleIdentifier = await prompt(
    "iOS bundle identifier",
    existing.appStoreConnect?.bundleIdentifier,
  );
  const ascAppId = await prompt(
    "App Store Connect app ID (optional)",
    existing.appStoreConnect?.ascAppId,
  );
  const privateKeyPath = await prompt("App Store Connect .p8 private key path");
  const privateKey = await readFile(privateKeyPath, "utf8");
  const transporterPath = await prompt(
    "Transporter path (optional)",
    existing.appStoreConnect?.transporterPath,
  );
  await saveCredentials(
    root,
    {
      ...existing,
      appStoreConnect: {
        apiKeyId,
        issuerId,
        privateKey,
        bundleIdentifier,
        ascAppId: ascAppId || undefined,
        transporterPath: transporterPath || undefined,
      },
    },
    { global: true },
  );
}

function keytoolPath(root: string): string {
  const javaHome = process.env.JAVA_HOME;
  const executable = process.platform === "win32" ? "keytool.exe" : "keytool";
  const candidates = [
    javaHome ? join(javaHome, "bin", executable) : undefined,
    join(root, "..", "..", ".tools", "jdk-17.0.20+8", "bin", executable),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((value) => existsSync(value)) ?? executable;
}

async function generateAndroidKeystore(
  root: string,
  keyAlias: string,
): Promise<{ path: string; password: string }> {
  const directory = join(globalLynxShipDirectory(), "keys");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "android-release.jks");
  try {
    await access(path);
    throw new Error(
      `An Android keystore already exists at ${path}. Configure it explicitly or remove it before generating a new one.`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const password = randomBytes(48).toString("base64url");
  const environment = {
    ...process.env,
    LYNXSHIP_KEYTOOL_STOREPASS: password,
    LYNXSHIP_KEYTOOL_KEYPASS: password,
  };
  const args = [
    "-genkeypair",
    "-keystore",
    path,
    "-storetype",
    "JKS",
    "-alias",
    keyAlias,
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "10000",
    "-dname",
    "CN=LynxShip Android, OU=Development, O=LynxShip, C=FR",
    "-storepass:env",
    "LYNXSHIP_KEYTOOL_STOREPASS",
    "-keypass:env",
    "LYNXSHIP_KEYTOOL_KEYPASS",
    "-noprompt",
  ];
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(keytoolPath(root), args, {
        env: environment,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`keytool failed with exit code ${code ?? "unknown"}`),
          );
      });
    });
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
  return { path, password };
}

export async function configureAndroid(
  root: string,
): Promise<AndroidConfigurationResult> {
  const existing = await loadCredentials(root);
  const current = existing.android;
  const keystorePath = await prompt(
    "Android keystore path (leave empty to generate automatically)",
    current?.keystorePath ?? process.env.LYNXSHIP_KEYSTORE_PATH,
  );
  const keyAlias = await prompt(
    "Android key alias",
    current?.keyAlias ?? process.env.LYNXSHIP_KEY_ALIAS ?? "lynxship-demo",
  );
  const generated = !keystorePath;
  const generatedKeystore = generated
    ? await generateAndroidKeystore(root, keyAlias)
    : undefined;
  const resolvedKeystorePath = generatedKeystore?.path ?? keystorePath;
  const keystorePassword =
    generatedKeystore?.password ?? (await secret("Android keystore password"));
  const keyPassword =
    generatedKeystore?.password ?? (await secret("Android key password"));
  try {
    await access(resolvedKeystorePath);
  } catch {
    throw new Error(`Android keystore was not found: ${resolvedKeystorePath}`);
  }
  const credentials: StoredCredentials = {
    ...existing,
    android: {
      keystorePath: resolvedKeystorePath,
      keyAlias,
      keystorePassword,
      keyPassword,
    },
  };
  await saveCredentials(root, credentials, { global: true });
  return { keystorePath: resolvedKeystorePath, generated };
}
