import type { Platform } from "@lynxship/contracts";
import type { NavigationChrome } from "./chrome.js";

export type NavigationValue = string | number | boolean | null;

export type NavigationTheme = "light" | "dark" | "system";

export type NavigationScreenOrientation =
  | "auto"
  | "portrait"
  | "portrait-upside-down"
  | "landscape"
  | "landscape-left"
  | "landscape-right";

export type NavigationStatusFontMode = "default" | "light" | "dark";

/** Presentation hints understood by a native Lynx container host. */
export interface NavigationPresentation {
  readonly title?: string;
  readonly hideNavBar?: boolean;
  readonly hideStatusBar?: boolean;
  readonly transparentStatusBar?: boolean;
  readonly showNavBarInTransparentStatusBar?: boolean;
  readonly navBarColor?: string;
  readonly titleColor?: string;
  readonly titleColorLight?: string;
  readonly titleColorDark?: string;
  readonly navBarColorLight?: string;
  readonly navBarColorDark?: string;
  readonly containerBackgroundColor?: string;
  readonly containerBackgroundColorLight?: string;
  readonly containerBackgroundColorDark?: string;
  /** Suppresses the default loading surface in a full-page host. */
  readonly hideLoading?: boolean;
  /** Background used while a full-page host is loading. */
  readonly loadingBackgroundColor?: string;
  readonly loadingBackgroundColorLight?: string;
  readonly loadingBackgroundColorDark?: string;
  /** Suppresses the default error surface in a full-page host. */
  readonly hideError?: boolean;
  readonly forceThemeStyle?: NavigationTheme;
  readonly screenOrientation?: NavigationScreenOrientation;
  readonly statusFontMode?: NavigationStatusFontMode;
  readonly hideBackButton?: boolean;
  readonly disableAutoRemoveLoading?: boolean;
  readonly fitSize?: boolean;
}

export interface NavigationTarget {
  readonly url: string;
  readonly params?: Readonly<Record<string, NavigationValue>>;
  readonly presentation?: NavigationPresentation;
}

export type NavigationOperation = "open" | "replace" | "system-browser";

export interface NavigationInterceptorContext {
  readonly operation: NavigationOperation;
  readonly target: NavigationTarget;
}

export type NavigationInterceptorResult =
  | void
  | { readonly cancel: true; readonly reason?: string }
  | { readonly target: NavigationTarget };

/** Runs before native navigation and may cancel or safely redirect a target. */
export type NavigationInterceptor = (
  context: NavigationInterceptorContext,
) => NavigationInterceptorResult | Promise<NavigationInterceptorResult>;

export interface NavigationPageRequest {
  readonly path: string;
  readonly baseScheme?: string;
  readonly params?: Readonly<Record<string, NavigationValue>>;
  readonly replace?: boolean;
  readonly presentation?: NavigationPresentation;
}

export interface NavigationPolicy {
  readonly schemes?: readonly string[];
  readonly httpsHosts?: readonly string[];
}

export interface NavigationAdapter {
  readonly platform: Platform;
  /** Creates a container without presenting it, when the native host supports it. */
  create?(target: NavigationTarget): Promise<void>;
  open(target: NavigationTarget): Promise<void>;
  replace(target: NavigationTarget): Promise<void>;
  /** Opens an HTTP(S) target in the platform browser without changing the stack. */
  openInSystemBrowser?(target: NavigationTarget): Promise<void>;
  back(): Promise<boolean>;
  /**
   * Enables the opt-in native back-press event. When enabled, the host emits
   * `lynxship:navigation-back-press` to the active Lynx page instead of
   * finishing immediately. The page can call `back()` to confirm navigation.
   */
  setBackPressHandling?(enabled: boolean): Promise<void>;
  /** Close the active page when the host distinguishes close from back. */
  close?(): Promise<boolean>;
  /** Updates the native full-page toolbar without changing the route stack. */
  updateChrome?(chrome: NavigationChrome): Promise<void>;
}

export type NavigationEvent =
  | {
      readonly type: "will-open";
      readonly id: string;
      readonly target: NavigationTarget;
    }
  | {
      readonly type: "did-open";
      readonly id: string;
      readonly target: NavigationTarget;
    }
  | {
      readonly type: "did-back";
      readonly id: string;
      readonly changed: boolean;
    }
  | {
      readonly type: "did-close";
      readonly id: string;
      readonly changed: boolean;
    }
  | {
      readonly type: "failed";
      readonly id: string;
      readonly error: unknown;
    }
  | {
      readonly type: "disposed";
      readonly id: string;
    };

export interface NavigationController {
  readonly platform: Platform;
  readonly current: NavigationTarget | undefined;
  /** Logical route stack maintained after the native adapter confirms a change. */
  readonly stack: readonly NavigationTarget[];
  /** Creates a native container without presenting it. */
  create?(target: NavigationTarget): Promise<void>;
  open(target: NavigationTarget): Promise<void>;
  navigate(request: NavigationPageRequest): Promise<void>;
  replace(target: NavigationTarget): Promise<void>;
  /** Opens an HTTP(S) target in Safari/Android browser without changing the stack. */
  openInSystemBrowser?(target: NavigationTarget): Promise<void>;
  back(): Promise<boolean>;
  /** Enables or disables the opt-in native back-press event. */
  setBackPressHandling(enabled: boolean): Promise<void>;
  close(): Promise<boolean>;
  /** Applies a validated, serializable toolbar model to the active native page. */
  updateChrome(chrome: NavigationChrome): Promise<void>;
  subscribe(listener: (event: NavigationEvent) => void): () => void;
  dispose(): void;
}
