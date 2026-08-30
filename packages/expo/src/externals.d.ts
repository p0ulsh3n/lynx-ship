declare module "react" {
  export interface ReactElement {
    readonly type: unknown;
    readonly props: unknown;
  }
  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined;
  export type ComponentType<Props = Record<string, unknown>> = (
    props: Props,
  ) => ReactNode;
  export function createElement(
    type: unknown,
    props: Record<string, unknown> | null,
  ): ReactNode;
  export function forwardRef<T, Props>(
    render: (props: Props, ref: T | null) => ReactNode,
  ): ComponentType<Props & { ref?: T | null }>;
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
