import { NavigationError } from "./errors.js";
import { normalizeNavigationTarget } from "./policy.js";
import type {
  NavigationPolicy,
  NavigationPresentation,
  NavigationValue,
} from "./contracts.js";

export interface LynxSchemeOptions {
  /** Full-page or embedded host scheme, e.g. hybrid://lynxview_page. */
  readonly baseScheme?: string;
  /** Bundle-relative entrypoint; absolute URLs are deliberately rejected. */
  readonly path: string;
  readonly params?: Readonly<Record<string, NavigationValue>>;
  readonly presentation?: NavigationPresentation;
  readonly policy?: NavigationPolicy;
}

function invalid(message: string): never {
  throw new NavigationError("NAVIGATION_INVALID_TARGET", message);
}

/** Build a validated scheme URL for a Lynx bundle without string concatenation. */
export function buildLynxScheme(options: LynxSchemeOptions): string {
  const path = options.path.trim();
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("://") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  )
    invalid("Lynx scheme bundle paths must be relative and safe.");

  const base = options.baseScheme ?? "hybrid://lynxview_page";
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    invalid("Lynx scheme base must be an absolute URL.");
  }
  parsed.searchParams.set("bundle", path);
  for (const [key, value] of presentationParams(options.presentation))
    parsed.searchParams.set(key, value);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value === undefined)
      invalid("Lynx scheme parameters must not be undefined.");
    parsed.searchParams.set(key, String(value));
  }

  return normalizeNavigationTarget(
    { url: parsed.toString(), presentation: options.presentation },
    options.policy,
  ).url;
}

function presentationParams(
  presentation: NavigationPresentation | undefined,
): readonly (readonly [string, string])[] {
  if (!presentation) return [];
  const booleanParam = (value: boolean | undefined): string | undefined =>
    value === undefined ? undefined : value ? "1" : "0";
  return Object.entries({
    title: presentation.title,
    hide_nav_bar: booleanParam(presentation.hideNavBar),
    hide_status_bar: booleanParam(presentation.hideStatusBar),
    trans_status_bar: booleanParam(presentation.transparentStatusBar),
    show_nav_bar_in_trans_status_bar: booleanParam(
      presentation.showNavBarInTransparentStatusBar,
    ),
    nav_bar_color: presentation.navBarColor,
    title_color: presentation.titleColor,
    container_bg_color: presentation.containerBackgroundColor,
    hide_loading: booleanParam(presentation.hideLoading),
    loading_bg_color: presentation.loadingBackgroundColor,
    hide_error: booleanParam(presentation.hideError),
    force_theme_style: presentation.forceThemeStyle,
    screen_orientation: presentation.screenOrientation,
    status_font_mode: presentation.statusFontMode,
    hide_back_button: booleanParam(presentation.hideBackButton),
    disable_auto_remove_loading: booleanParam(
      presentation.disableAutoRemoveLoading,
    ),
    title_color_light: presentation.titleColorLight,
    title_color_dark: presentation.titleColorDark,
    nav_bar_color_light: presentation.navBarColorLight,
    nav_bar_color_dark: presentation.navBarColorDark,
    container_bg_color_light: presentation.containerBackgroundColorLight,
    container_bg_color_dark: presentation.containerBackgroundColorDark,
    loading_bg_color_light: presentation.loadingBackgroundColorLight,
    loading_bg_color_dark: presentation.loadingBackgroundColorDark,
    FitSize: booleanParam(presentation.fitSize),
  }).filter((entry): entry is [string, string] => entry[1] !== undefined);
}

export interface ParsedLynxScheme {
  readonly url: string;
  readonly bundle: string;
  readonly params: Readonly<Record<string, string>>;
}

/** Validate and parse a host scheme before handing it to a native router. */
export function parseLynxScheme(
  url: string,
  policy?: NavigationPolicy,
): ParsedLynxScheme {
  const normalized = normalizeNavigationTarget({ url }, policy).url;
  const parsed = new URL(normalized);
  const bundle = parsed.searchParams.get("bundle");
  if (!bundle) invalid("Lynx schemes must identify a bundle.");
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    if (key !== "bundle") params[key] = value;
  });
  return { url: normalized, bundle, params: Object.freeze(params) };
}
