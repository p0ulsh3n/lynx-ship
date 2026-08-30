import { NavigationError } from "./errors.js";
import type {
  NavigationPolicy,
  NavigationPresentation,
  NavigationTarget,
  NavigationValue,
} from "./contracts.js";

const DEFAULT_SCHEMES = ["lynx:", "lynxship:", "hybrid:", "https:"] as const;
const MAX_NAVIGATION_URL_LENGTH = 8_192;
const MAX_NAVIGATION_PARAMS = 64;

function invalid(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new NavigationError("NAVIGATION_INVALID_TARGET", message, details);
}

function validateValue(key: string, value: NavigationValue): void {
  if (!/^[A-Za-z0-9_.~-]{1,128}$/.test(key))
    invalid("Navigation parameter names must be safe ASCII identifiers.", {
      key,
    });
  if (typeof value === "string" && /[\u0000-\u001f\u007f]/.test(value))
    invalid(
      "Navigation parameter values must not contain control characters.",
      {
        key,
      },
    );
  if (typeof value === "number" && !Number.isFinite(value))
    invalid("Navigation numeric parameters must be finite.", { key });
}

function validatePresentation(
  value: NavigationPresentation | undefined,
): NavigationPresentation | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null)
    invalid("Navigation presentation must be an object.");
  if (
    value.title !== undefined &&
    (!value.title.trim() ||
      value.title.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(value.title))
  )
    invalid("Navigation presentation title is invalid.");
  for (const [key, field] of [
    ["hideNavBar", value.hideNavBar],
    ["hideStatusBar", value.hideStatusBar],
    ["transparentStatusBar", value.transparentStatusBar],
    [
      "showNavBarInTransparentStatusBar",
      value.showNavBarInTransparentStatusBar,
    ],
    ["hideLoading", value.hideLoading],
    ["hideError", value.hideError],
    ["hideBackButton", value.hideBackButton],
    ["disableAutoRemoveLoading", value.disableAutoRemoveLoading],
    ["fitSize", value.fitSize],
  ] as const)
    if (field !== undefined && typeof field !== "boolean")
      invalid(`Navigation presentation ${key} must be boolean.`);
  for (const [key, field] of [
    ["navBarColor", value.navBarColor],
    ["titleColor", value.titleColor],
    ["containerBackgroundColor", value.containerBackgroundColor],
    ["loadingBackgroundColor", value.loadingBackgroundColor],
    ["titleColorLight", value.titleColorLight],
    ["titleColorDark", value.titleColorDark],
    ["navBarColorLight", value.navBarColorLight],
    ["navBarColorDark", value.navBarColorDark],
    ["containerBackgroundColorLight", value.containerBackgroundColorLight],
    ["containerBackgroundColorDark", value.containerBackgroundColorDark],
    ["loadingBackgroundColorLight", value.loadingBackgroundColorLight],
    ["loadingBackgroundColorDark", value.loadingBackgroundColorDark],
  ] as const)
    if (field !== undefined && !/^#[0-9a-f]{6}$/i.test(field))
      invalid(`Navigation presentation ${key} must be a six-digit RGB color.`);
  if (
    value.forceThemeStyle !== undefined &&
    !["light", "dark", "system"].includes(value.forceThemeStyle)
  )
    invalid("Navigation presentation forceThemeStyle is invalid.");
  if (
    value.screenOrientation !== undefined &&
    ![
      "auto",
      "portrait",
      "portrait-upside-down",
      "landscape",
      "landscape-left",
      "landscape-right",
    ].includes(value.screenOrientation)
  )
    invalid("Navigation presentation screenOrientation is invalid.");
  if (
    value.statusFontMode !== undefined &&
    !["default", "light", "dark"].includes(value.statusFontMode)
  )
    invalid("Navigation presentation statusFontMode is invalid.");
  return Object.freeze({ ...value });
}

export function normalizeNavigationTarget(
  target: NavigationTarget,
  policy: NavigationPolicy = {},
): NavigationTarget {
  if (!target.url.trim() || /[\u0000-\u001f\u007f]/.test(target.url))
    invalid(
      "Navigation URLs must be non-empty and free of control characters.",
    );
  if (target.url.length > MAX_NAVIGATION_URL_LENGTH)
    invalid("Navigation URLs exceed the supported length.");
  const presentation = validatePresentation(target.presentation);
  let parsed: URL;
  try {
    parsed = new URL(target.url);
  } catch {
    invalid("Navigation URLs must be absolute URLs.", { url: target.url });
  }
  if (parsed.username || parsed.password)
    invalid("Navigation URLs must not contain embedded credentials.");
  const schemes = new Set(
    (policy.schemes ?? DEFAULT_SCHEMES).map((scheme) =>
      scheme.endsWith(":") ? scheme.toLowerCase() : `${scheme.toLowerCase()}:`,
    ),
  );
  if (!schemes.has(parsed.protocol.toLowerCase()))
    invalid("Navigation URL scheme is not allowed.", {
      scheme: parsed.protocol,
    });
  if (
    parsed.protocol.toLowerCase() === "https:" &&
    policy.httpsHosts &&
    !policy.httpsHosts.some(
      (host) => host.toLowerCase() === parsed.hostname.toLowerCase(),
    )
  )
    invalid("Navigation HTTPS host is not allowed.", { host: parsed.hostname });

  const params = target.params;
  if (params) {
    if (Object.keys(params).length > MAX_NAVIGATION_PARAMS)
      invalid("Navigation targets contain too many parameters.");
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined)
        invalid("Navigation parameters must not be undefined.", { key });
      validateValue(key, value);
      parsed.searchParams.set(key, String(value));
    }
  }
  const normalizedUrl = parsed.toString();
  if (normalizedUrl.length > MAX_NAVIGATION_URL_LENGTH)
    invalid("Navigation URLs exceed the supported length.");
  return {
    url: normalizedUrl,
    ...(presentation ? { presentation } : {}),
  };
}
