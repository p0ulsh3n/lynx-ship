declare module "expo-notifications" {
  export interface NotificationPermissionsStatus {
    granted: boolean;
    canAskAgain?: boolean;
    status?: string;
  }

  export interface DevicePushToken {
    type: string;
    data: string | Uint8Array;
  }

  export interface NotificationChannelInput {
    name: string;
    importance?: number;
    sound?: string;
    vibrationPattern?: number[];
  }

  export function getPermissionsAsync(): Promise<NotificationPermissionsStatus>;
  export function requestPermissionsAsync(
    permissions?: Record<string, unknown>,
  ): Promise<NotificationPermissionsStatus>;
  export function setNotificationChannelAsync(
    channelId: string,
    channel: NotificationChannelInput,
  ): Promise<unknown>;
  export function getDevicePushTokenAsync(): Promise<DevicePushToken>;
  export function addPushTokenListener(
    listener: (token: DevicePushToken) => void,
  ): { remove(): void };
}

declare module "react-native" {
  export const Platform: { OS: string };
}

declare module "expo-constants" {
  const Constants: {
    expoConfig?: {
      android?: { package?: string };
      ios?: { bundleIdentifier?: string };
    };
  };
  export default Constants;
}
