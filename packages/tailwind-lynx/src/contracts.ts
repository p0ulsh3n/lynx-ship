export interface TailwindProjectConfig {
  readonly configPath?: string;
  readonly presetPackage?: string;
  readonly content?: readonly string[];
}

export interface TailwindValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly recommendation?: string;
}

export interface TailwindBuildPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly reason: string;
}
