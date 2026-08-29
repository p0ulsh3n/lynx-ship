import { LynxContext, LynxModule } from '@lynx/lynx';
import { preferences } from '@kit.ArkData';

/**
 * HarmonyOS implementation of the LynxShip device-storage module.
 *
 * Lynx documents Preferences as the platform storage primitive for HarmonyOS
 * native modules. The module is intentionally not marked Sendable: the bridge
 * methods use callbacks and therefore stay off the synchronous Sendable path.
 */
export class LynxShipDeviceStorageModule extends LynxModule {
  private static readonly STORE_NAME: string = 'lynxship.device-storage';
  private dataPreferences: preferences.Preferences | null = null;

  constructor(context: LynxContext, param?: Object) {
    super(context, param);
    this.initializePreferences();
  }

  private initializePreferences(): void {
    try {
      this.dataPreferences = preferences.getPreferencesSync(getContext(), {
        name: LynxShipDeviceStorageModule.STORE_NAME,
      });
    } catch (error) {
      console.error(`LynxShip device storage initialization failed: ${error}`);
    }
  }

  public getItem(key: string, callback: (value: string | null) => void): void {
    const store = this.dataPreferences;
    if (!store) {
      callback(null);
      return;
    }
    try {
      const value = store.getSync(key, null);
      callback(typeof value === 'string' ? value : null);
    } catch (error) {
      console.error(`LynxShip device storage read failed: ${error}`);
      callback(null);
    }
  }

  public setItem(
    key: string,
    value: string,
    callback: (success: boolean) => void,
  ): void {
    const store = this.dataPreferences;
    if (!store) {
      callback(false);
      return;
    }
    try {
      store.putSync(key, value);
      store.flushSync();
      callback(true);
    } catch (error) {
      console.error(`LynxShip device storage write failed: ${error}`);
      callback(false);
    }
  }

  public removeItem(key: string, callback: (success: boolean) => void): void {
    const store = this.dataPreferences;
    if (!store) {
      callback(false);
      return;
    }
    try {
      store.deleteSync(key);
      store.flushSync();
      callback(true);
    } catch (error) {
      console.error(`LynxShip device storage delete failed: ${error}`);
      callback(false);
    }
  }

  public clear(callback: (success: boolean) => void): void {
    const store = this.dataPreferences;
    if (!store) {
      callback(false);
      return;
    }
    try {
      store.clearSync();
      store.flushSync();
      callback(true);
    } catch (error) {
      console.error(`LynxShip device storage clear failed: ${error}`);
      callback(false);
    }
  }
}
