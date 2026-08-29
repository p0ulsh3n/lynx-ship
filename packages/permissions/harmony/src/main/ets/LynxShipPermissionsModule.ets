import { LynxContext, LynxModule } from '@lynx/lynx';
import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { notificationManager } from '@kit.NotificationKit';

type PermissionCallback = (state: string) => void;
type SettingsCallback = (success: boolean) => void;

/**
 * HarmonyOS permission bridge.
 *
 * Camera and microphone use the current AccessToken APIs. Notifications are
 * governed by NotificationKit rather than an `ohos.permission.*` token, so
 * they are handled through isNotificationEnabled/requestEnableNotification.
 */
export class LynxShipPermissionsModule extends LynxModule {
  private static readonly CAMERA_PERMISSION: Permissions = 'ohos.permission.CAMERA';
  private static readonly MICROPHONE_PERMISSION: Permissions = 'ohos.permission.MICROPHONE';
  private static readonly SETTINGS_BUNDLE: string = 'com.huawei.hmos.settings';
  private static readonly SETTINGS_ABILITY: string = 'com.huawei.hmos.settings.MainAbility';

  constructor(context: LynxContext, param?: Object) {
    super(context, param);
  }

  public checkPermission(name: string, callback: PermissionCallback): void {
    if (name === 'notifications') {
      this.checkNotifications(callback);
      return;
    }

    const permission = this.resolvePermission(name);
    if (!permission) {
      callback('unavailable');
      return;
    }

    try {
      const status = abilityAccessCtrl
        .createAtManager()
        .checkAccessTokenSync(this.getAbilityContext().applicationInfo.accessTokenId, permission);
      callback(status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED ? 'granted' : 'denied');
    } catch (error) {
      console.error(`LynxShip permission check failed: ${error}`);
      callback('unavailable');
    }
  }

  public requestPermission(name: string, callback: PermissionCallback): void {
    if (name === 'notifications') {
      this.requestNotifications(callback);
      return;
    }

    const permission = this.resolvePermission(name);
    if (!permission) {
      callback('unavailable');
      return;
    }

    const context = this.getAbilityContext();
    const access = abilityAccessCtrl.createAtManager();
    try {
      const current = access.checkAccessTokenSync(
        context.applicationInfo.accessTokenId,
        permission,
      );
      if (current === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
        callback('granted');
        return;
      }

      access.requestPermissionsFromUser(context, [permission], 0, (error, result) => {
        if (error) {
          console.error(`LynxShip permission request failed: ${error}`);
          callback('unavailable');
          return;
        }
        const granted = result.authResults.length > 0 && result.authResults[0] === 0;
        const shown = result.dialogShownResults.length > 0 && result.dialogShownResults[0];
        callback(granted ? 'granted' : shown ? 'denied' : 'blocked');
      });
    } catch (error) {
      console.error(`LynxShip permission request failed: ${error}`);
      callback('unavailable');
    }
  }

  public openSettings(callback: SettingsCallback): void {
    try {
      this.getAbilityContext()
        .startAbility({
          bundleName: LynxShipPermissionsModule.SETTINGS_BUNDLE,
          abilityName: LynxShipPermissionsModule.SETTINGS_ABILITY,
          // An empty URI opens the system settings entry point. The bundle
          // parameter lets the system resolve the current app's settings.
          uri: '',
          parameters: {
            pushParams: {
              bundleName: this.getAbilityContext().abilityInfo.bundleName,
            },
          },
        })
        .then(() => callback(true))
        .catch(() => callback(false));
    } catch (error) {
      console.error(`LynxShip settings launch failed: ${error}`);
      callback(false);
    }
  }

  private resolvePermission(name: string): Permissions | null {
    if (name === 'camera') return LynxShipPermissionsModule.CAMERA_PERMISSION;
    if (name === 'microphone' || name === 'audio') {
      return LynxShipPermissionsModule.MICROPHONE_PERMISSION;
    }
    return name.startsWith('ohos.permission.') ? (name as Permissions) : null;
  }

  private getAbilityContext(): common.UIAbilityContext {
    return getContext() as common.UIAbilityContext;
  }

  private checkNotifications(callback: PermissionCallback): void {
    notificationManager
      .isNotificationEnabled()
      .then((enabled: boolean) => callback(enabled ? 'granted' : 'denied'))
      .catch(() => callback('unavailable'));
  }

  private requestNotifications(callback: PermissionCallback): void {
    const context = this.getAbilityContext();
    notificationManager
      .requestEnableNotification(context)
      .then(() => callback('granted'))
      .catch(() => {
        this.checkNotifications(callback);
      });
  }
}
