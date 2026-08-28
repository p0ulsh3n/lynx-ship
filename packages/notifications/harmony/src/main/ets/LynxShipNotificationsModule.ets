import { LynxContext } from '@lynx/lynx';
import { LynxShipNotificationsSpec } from './generated/LynxShipNotificationsSpec';
import { BusinessError } from '@kit.BasicServicesKit';
import { notificationManager } from '@kit.NotificationKit';
import { pushService } from '@kit.PushKit';

/**
 * HarmonyOS Push Kit bridge.
 *
 * The generated spec is intentionally primitive-only because the current
 * Lynx Harmony codegen cannot describe function parameters. The Async methods
 * below follow Lynx's documented handwritten Harmony Native Module contract.
 */
export class LynxShipNotificationsModule extends LynxShipNotificationsSpec {
  private cachedToken: string = '';

  constructor(context: LynxContext, param?: Object) {
    super(context, param);
  }

  requestPermission(): boolean {
    try {
      return notificationManager.isNotificationEnabledSync();
    } catch (_) {
      return false;
    }
  }

  getToken(): string {
    return this.cachedToken;
  }

  clearTokenChangeListeners(): void {}

  /** Requests consent, then reports the final notification state. */
  requestPermissionAsync(callback: (granted: boolean) => void): void {
    notificationManager.isNotificationEnabled()
      .then((enabled: boolean) => {
        if (enabled) {
          callback(true);
          return;
        }
        // The context-aware overload requires a UIAbilityContext. A Lynx
        // module only has LynxContext, so use Huawei's documented legacy
        // overload; it remains available for Stage-model applications.
        return notificationManager.requestEnableNotification()
          .then(() => notificationManager.isNotificationEnabled())
          .then((value: boolean) => callback(value))
          .catch(() => callback(false));
      })
      .catch(() => callback(false));
  }

  /** Gets the current token from Huawei Push Kit without exposing errors. */
  getTokenAsync(callback: (token: string) => void): void {
    try {
      pushService.getToken((error: BusinessError, token: string) => {
        if (error || !token) {
          callback('');
          return;
        }
        this.cachedToken = token;
        callback(token);
      });
    } catch (_) {
      callback('');
    }
  }
}
