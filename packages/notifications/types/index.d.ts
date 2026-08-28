/**
 * Native API consumed by the pure Lynx facade.
 * @lynxmodule
 */
export declare class LynxShipNotifications {
  requestPermission(): boolean;

  getToken(): string;

  clearTokenChangeListeners(): void;
}
