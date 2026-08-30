export class NavigationError extends Error {
  public readonly code:
    | "NAVIGATION_INVALID_TARGET"
    | "NAVIGATION_PLATFORM_MISMATCH"
    | "NAVIGATION_DISPOSED"
    | "NAVIGATION_CAPABILITY_MISSING"
    | "NAVIGATION_INTERCEPTED";

  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: NavigationError["code"],
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "NavigationError";
    this.code = code;
    this.details = details;
  }
}
