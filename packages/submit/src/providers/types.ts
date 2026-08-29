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
