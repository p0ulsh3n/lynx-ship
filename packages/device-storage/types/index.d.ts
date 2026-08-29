export interface LynxShipDeviceStorageModule {
  getItem(key: string, callback: (value: string | null) => void): void;
  setItem(
    key: string,
    value: string,
    callback?: (success: boolean) => void,
  ): void;
  removeItem(key: string, callback?: (success: boolean) => void): void;
  clear(callback?: (success: boolean) => void): void;
}
