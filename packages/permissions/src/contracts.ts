export type PermissionState =
  | "unknown"
  | "granted"
  | "denied"
  | "blocked"
  | "unavailable";

export type PermissionName = string;

export interface PermissionResult {
  readonly name: PermissionName;
  readonly state: PermissionState;
  readonly canAskAgain: boolean;
}

export interface PermissionAdapter {
  check(name: PermissionName): Promise<PermissionResult>;
  request(name: PermissionName): Promise<PermissionResult>;
  openSettings?(): Promise<void>;
}

export interface PermissionClient {
  check(name: PermissionName): Promise<PermissionResult>;
  request(name: PermissionName): Promise<PermissionResult>;
  requestMany(
    names: readonly PermissionName[],
  ): Promise<readonly PermissionResult[]>;
  openSettings(): Promise<void>;
}

export class PermissionError extends Error {
  public readonly code = "PERMISSION_ADAPTER_MISSING";

  public constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}
