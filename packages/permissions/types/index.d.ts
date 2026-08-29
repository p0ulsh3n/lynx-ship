export type PermissionState =
  | "unknown"
  | "granted"
  | "denied"
  | "blocked"
  | "unavailable";

export interface LynxShipPermissionsModule {
  checkPermission(
    name: string,
    callback: (state: PermissionState) => void,
  ): void;
  requestPermission(
    name: string,
    callback: (state: PermissionState) => void,
  ): void;
  openSettings(callback?: (success: boolean) => void): void;
}
