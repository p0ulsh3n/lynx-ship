declare module "react" {
  export type ComponentType<Props = Record<string, unknown>> = (
    props: Props,
  ) => unknown;
  export function createElement(
    type: unknown,
    props: Record<string, unknown> | null,
  ): unknown;
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
  ): (props: Props) => unknown;
}
