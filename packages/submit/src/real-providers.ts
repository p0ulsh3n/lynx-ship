import { createSign } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { assert } from "@lynxship/contracts";

export interface StoreArtifactInput {
  platform: "android" | "ios";
  path: string;
  hash?: string;
}

export interface StoreSubmissionResult {
  provider: "google-play" | "app-store-connect";
  remoteId: string;
  status: "submitted" | "uploaded";
  message: string;
  track?: string;
}

interface RequestOptions {
  fetchImpl?: typeof fetch;
  retries?: number;
}

export interface GooglePlayCredentials {
  serviceAccountJson: string;
  applicationId: string;
  track: string;
  releaseStatus: "draft" | "completed" | "inProgress" | "halted";
}

export interface AppStoreConnectCredentials {
  apiKeyId: string;
  issuerId: string;
  privateKey: string;
  bundleIdentifier: string;
  ascAppId?: string;
  transporterPath?: string;
}

function base64Url(value: string | Buffer): string {
  return (Buffer.isBuffer(value) ? value : Buffer.from(value)).toString(
    "base64url",
  );
}

function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: string,
): string {
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const input = encodedHeader + "." + encodedPayload;
  const signer = createSign("SHA256");
  signer.update(input);
  signer.end();
  const signature = signer.sign({
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return input + "." + base64Url(signature);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      if (response.ok || (response.status < 500 && response.status !== 429))
        return response;
      lastError = new Error("HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await delay(250 * 2 ** attempt);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Request failed after retries");
}

async function throwResponseError(
  response: Response,
  provider: string,
): Promise<never> {
  let detail = "";
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      errors?: Array<{ message?: string }>;
      message?: string;
    };
    detail =
      body.error?.message ?? body.errors?.[0]?.message ?? body.message ?? "";
  } catch {
    detail = await response.text().catch(() => "");
  }
  throw new Error(
    provider +
      " request failed (" +
      response.status +
      ")" +
      (detail ? ": " + detail : ""),
  );
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  provider: string,
  options?: RequestOptions,
): Promise<T> {
  const response = await fetchWithRetry(url, init, options);
  if (!response.ok) await throwResponseError(response, provider);
  return (await response.json()) as T;
}

function parseServiceAccount(value: string): {
  client_email: string;
  private_key: string;
  token_uri?: string;
} {
  const credentials = JSON.parse(value) as {
    client_email?: string;
    private_key?: string;
    token_uri?: string;
  };
  assert(
    credentials.client_email && credentials.private_key,
    "GOOGLE_CREDENTIALS_INVALID",
    "Google service account JSON must contain client_email and private_key",
  );
  return credentials as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
}

async function googleAccessToken(
  account: ReturnType<typeof parseServiceAccount>,
  options?: RequestOptions,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
  );
  const response = await fetchWithRetry(
    tokenUri,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    },
    options,
  );
  if (!response.ok) await throwResponseError(response, "Google OAuth");
  const body = (await response.json()) as { access_token?: string };
  assert(
    body.access_token,
    "GOOGLE_TOKEN_INVALID",
    "Google OAuth did not return an access token",
  );
  return body.access_token;
}

function googleBase(applicationId: string): string {
  return (
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    encodeURIComponent(applicationId)
  );
}

export class GooglePlayApiProvider {
  constructor(
    readonly credentials: GooglePlayCredentials,
    readonly options: RequestOptions = {},
  ) {}

  async submit(input: StoreArtifactInput): Promise<StoreSubmissionResult> {
    assert(
      input.platform === "android",
      "SUBMISSION_PLATFORM",
      "Google Play accepts Android artifacts only",
    );
    const extension = extname(input.path).toLowerCase();
    assert(
      extension === ".aab" || extension === ".apk",
      "GOOGLE_ARTIFACT_INVALID",
      "Google Play submission requires an .aab or .apk artifact",
    );
    await access(input.path);
    const account = parseServiceAccount(this.credentials.serviceAccountJson);
    const token = await googleAccessToken(account, this.options);
    const headers = {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    };
    const base = googleBase(this.credentials.applicationId);
    const edit = await jsonRequest<{ id?: string }>(
      base + "/edits",
      { method: "POST", headers, body: "{}" },
      "Google Play",
      this.options,
    );
    assert(
      edit.id,
      "GOOGLE_EDIT_INVALID",
      "Google Play did not return an edit ID",
    );

    const binary = await readFile(input.path);
    const resource = extension === ".aab" ? "bundles" : "apks";
    const uploadUrl =
      "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/" +
      encodeURIComponent(this.credentials.applicationId) +
      "/edits/" +
      encodeURIComponent(edit.id) +
      "/" +
      resource;
    const uploaded = await jsonRequest<{ versionCode?: number | string }>(
      uploadUrl,
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type":
            extension === ".aab"
              ? "application/octet-stream"
              : "application/vnd.android.package-archive",
        },
        body: new Uint8Array(binary),
      },
      "Google Play",
      this.options,
    );
    assert(
      uploaded.versionCode !== undefined,
      "GOOGLE_UPLOAD_INVALID",
      "Google Play did not return the uploaded version code",
    );

    await jsonRequest(
      base +
        "/edits/" +
        encodeURIComponent(edit.id) +
        "/tracks/" +
        encodeURIComponent(this.credentials.track),
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          releases: [
            {
              versionCodes: [String(uploaded.versionCode)],
              status: this.credentials.releaseStatus,
            },
          ],
        }),
      },
      "Google Play",
      this.options,
    );
    const committed = await jsonRequest<{ id?: string }>(
      base + "/edits/" + encodeURIComponent(edit.id) + ":commit",
      { method: "POST", headers, body: "{}" },
      "Google Play",
      this.options,
    );
    return {
      provider: "google-play",
      remoteId: committed.id ?? edit.id,
      status: "submitted",
      message:
        "Android artifact uploaded to Google Play track " +
        this.credentials.track,
      track: this.credentials.track,
    };
  }
}

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
