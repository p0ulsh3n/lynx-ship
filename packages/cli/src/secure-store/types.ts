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
