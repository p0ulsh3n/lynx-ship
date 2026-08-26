declare module "react" {
  export type ReactNode = unknown;
  export type ComponentType<Props = Record<string, unknown>> = (
    props: Props,
  ) => ReactNode;
  export function createElement(
    type: unknown,
    props: Record<string, unknown> | null,
  ): ReactNode;
}

declare module "react-native" {
  export interface ViewProps {
    accessibilityLabel?: string;
    style?: unknown;
    testID?: string;
  }
}

declare module "expo-modules-core" {
  export function requireNativeViewManager<Props = Record<string, unknown>>(
    moduleName: string,
  ): (props: Props) => import("react").ReactNode;
}
