export interface CliGuidance {
  commands: string[];
  note?: string;
  environment?: string;
}

export interface GuidanceContext {
  args?: readonly string[];
  hostPlatform?: NodeJS.Platform;
}
