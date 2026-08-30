export type FrameworkPlatform =
  | "android"
  | "ios"
  | "harmony"
  | "web"
  | "desktop";

export type FrameworkCapabilityPlatform = FrameworkPlatform | "all";

export interface FrameworkErrorDetails {
  readonly [key: string]: unknown;
}

export class FrameworkError extends Error {
  public readonly code: string;

  public readonly details: FrameworkErrorDetails;

  public constructor(
    code: string,
    message: string,
    details: FrameworkErrorDetails = {},
  ) {
    super(message);
    this.name = "FrameworkError";
    this.code = code;
    this.details = details;
  }
}
