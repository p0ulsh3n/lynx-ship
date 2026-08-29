import { createSign } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { assert } from "@lynxship/contracts";
import {
  jsonRequest,
  fetchWithRetry,
  throwResponseError,
  type RequestOptions,
} from "./http.js";
import type {
  GooglePlayCredentials,
  StoreArtifactInput,
  StoreSubmissionResult,
} from "./types.js";

export type {
  GooglePlayCredentials,
  StoreArtifactInput,
  StoreSubmissionResult,
} from "./types.js";

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
