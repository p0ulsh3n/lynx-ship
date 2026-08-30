import { NavigationError } from "./errors.js";

export type NavigationChromeActionRole = "back" | "close" | "action";

export interface NavigationChromeAction {
  readonly id: string;
  readonly role: NavigationChromeActionRole;
  readonly accessibilityLabel: string;
  readonly label?: string;
  readonly icon?: string;
  readonly enabled?: boolean;
  readonly destructive?: boolean;
}

/**
 * A serializable, host-rendered full-page navigation chrome model.
 *
 * It deliberately describes intent instead of accepting a native view or
 * executable callback. Android and iOS hosts can render it with their native
 * toolbar systems while web/desktop hosts can map the same model to their UI.
 */
export interface NavigationChrome {
  readonly visible?: boolean;
  readonly title?: string;
  readonly subtitle?: string;
  readonly backgroundColor?: string;
  readonly titleColor?: string;
  readonly subtitleColor?: string;
  readonly heightDp?: number;
  readonly translucent?: boolean;
  readonly safeArea?: "included" | "excluded";
  readonly leadingAction?: NavigationChromeAction;
  readonly trailingActions?: readonly NavigationChromeAction[];
}

const ACTION_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const ICON_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const MAX_ACTIONS = 4;
const MAX_STRING = 256;

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new NavigationError("NAVIGATION_INVALID_TARGET", message, details);
}

function text(value: string, field: string): string {
  if (
    !value.trim() ||
    value.length > MAX_STRING ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    invalid(`${field} must be a non-empty string of at most 256 characters.`);
  return value;
}

function color(value: string, field: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value))
    invalid(`${field} must be a six-digit RGB color.`);
  return value;
}

function action(
  value: NavigationChromeAction,
  field: string,
): NavigationChromeAction {
  if (typeof value !== "object" || value === null)
    invalid(`${field} must be an object.`);
  if (!ACTION_ID.test(value.id)) invalid(`${field}.id is invalid.`);
  if (!text(value.accessibilityLabel, `${field}.accessibilityLabel`))
    invalid(`${field}.accessibilityLabel is invalid.`);
  if (!["back", "close", "action"].includes(value.role))
    invalid(`${field}.role is invalid.`);
  if (value.label !== undefined) text(value.label, `${field}.label`);
  if (value.icon !== undefined && !ICON_NAME.test(value.icon))
    invalid(`${field}.icon must be a safe icon name.`);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean")
    invalid(`${field}.enabled must be boolean.`);
  if (value.destructive !== undefined && typeof value.destructive !== "boolean")
    invalid(`${field}.destructive must be boolean.`);
  return Object.freeze({ ...value });
}

/** Validate and freeze a toolbar model before it crosses a native boundary. */
export function normalizeNavigationChrome(
  chrome: NavigationChrome,
): NavigationChrome {
  if (typeof chrome !== "object" || chrome === null)
    invalid("Navigation chrome must be an object.");
  if (chrome.visible !== undefined && typeof chrome.visible !== "boolean")
    invalid("Navigation chrome visible must be boolean.");
  for (const [field, value] of [
    ["title", chrome.title],
    ["subtitle", chrome.subtitle],
  ] as const)
    if (value !== undefined) text(value, `chrome.${field}`);
  for (const [field, value] of [
    ["backgroundColor", chrome.backgroundColor],
    ["titleColor", chrome.titleColor],
    ["subtitleColor", chrome.subtitleColor],
  ] as const)
    if (value !== undefined) color(value, `chrome.${field}`);
  if (
    chrome.heightDp !== undefined &&
    (!Number.isFinite(chrome.heightDp) ||
      chrome.heightDp < 24 ||
      chrome.heightDp > 256)
  )
    invalid("Navigation chrome heightDp must be between 24 and 256.");
  if (
    chrome.translucent !== undefined &&
    typeof chrome.translucent !== "boolean"
  )
    invalid("Navigation chrome translucent must be boolean.");
  if (
    chrome.safeArea !== undefined &&
    !["included", "excluded"].includes(chrome.safeArea)
  )
    invalid("Navigation chrome safeArea is invalid.");
  const leadingAction = chrome.leadingAction
    ? action(chrome.leadingAction, "chrome.leadingAction")
    : undefined;
  const trailingActions = chrome.trailingActions
    ? chrome.trailingActions.map((entry, index) =>
        action(entry, `chrome.trailingActions[${index}]`),
      )
    : undefined;
  if (trailingActions && trailingActions.length > MAX_ACTIONS)
    invalid(
      `Navigation chrome supports at most ${MAX_ACTIONS} trailing actions.`,
    );
  const ids = new Set<string>();
  for (const item of [leadingAction, ...(trailingActions ?? [])]) {
    if (!item) continue;
    if (ids.has(item.id))
      invalid(`Navigation chrome contains duplicate action ${item.id}.`);
    ids.add(item.id);
  }
  return Object.freeze({
    ...chrome,
    ...(leadingAction ? { leadingAction } : {}),
    ...(trailingActions
      ? { trailingActions: Object.freeze(trailingActions) }
      : {}),
  });
}
