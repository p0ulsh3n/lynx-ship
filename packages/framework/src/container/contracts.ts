import type { CapabilityDescriptor } from "../capabilities/registry.js";
import type { FrameworkPlatform } from "../contracts/platform.js";

export interface BundleReference {
  readonly id: string;
  /** Omit path and url when the native host resolves an embedded bundle by id. */
  readonly path?: string;
  readonly url?: string;
  readonly sha256?: string;
}

export type ContainerTheme = "light" | "dark" | "system";

export type ContainerContentMode =
  | "fixed-size"
  | "fixed-width"
  | "fixed-height"
  | "fit-size";

export type ContainerKind = "page" | "embedded";

/** Host presentation hints for full-page and embedded Lynx containers. */
export interface ContainerPresentation {
  readonly kind?: ContainerKind;
  readonly title?: string;
  readonly hideNavigationBar?: boolean;
  readonly hideStatusBar?: boolean;
  readonly transparentStatusBar?: boolean;
  readonly showNavigationBarInTransparentStatusBar?: boolean;
  readonly navigationBarColor?: string;
  readonly titleColor?: string;
  readonly backgroundColor?: string;
  /** Host may suppress its default loading overlay. */
  readonly hideLoading?: boolean;
  /** Host-defined loading-surface background color. */
  readonly loadingBackgroundColor?: string;
  /** Host may suppress its default error/retry overlay. */
  readonly hideError?: boolean;
  readonly theme?: ContainerTheme;
  readonly contentMode?: ContainerContentMode;
}

export interface ContainerMountRequest {
  readonly bundle: BundleReference;
  readonly initialData?: Readonly<Record<string, unknown>>;
  readonly globalProps?: Readonly<Record<string, unknown>>;
  readonly presentation?: ContainerPresentation;
  readonly signal?: AbortSignal;
}

/**
 * Warms a bundle source without creating or presenting a Lynx view. A native
 * adapter may use this to populate its verified in-memory/disk cache; it must
 * not render UI or change the active container.
 */
export interface ContainerPrepareRequest {
  readonly bundle: BundleReference;
  readonly signal?: AbortSignal;
}

export interface ContainerUpdateRequest {
  readonly bundle: BundleReference;
  readonly reason?: string;
  readonly signal?: AbortSignal;
}

export interface ContainerSize {
  readonly width: number;
  readonly height: number;
}

export interface ContainerMountResult {
  readonly firstScreen: Promise<void>;
  /** Optional intrinsic size signal for embedded containers. */
  readonly intrinsicSize?: ContainerSize | Promise<ContainerSize>;
  /** Optional live size signal for content whose dimensions can change. */
  readonly subscribeIntrinsicSize?: (
    listener: (size: ContainerSize) => void,
  ) => () => void;
  readonly capabilities?: readonly CapabilityDescriptor[];
}

export interface LynxShipContainer {
  readonly platform: FrameworkPlatform;
  mount(request: ContainerMountRequest): Promise<ContainerMountResult>;
  update(request: ContainerUpdateRequest): Promise<void>;
  unmount(): Promise<void>;
}
