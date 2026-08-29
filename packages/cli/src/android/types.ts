import type { BuildProfile } from "../config.js";

export interface AndroidBuildOptions {
  root: string;
  profile: BuildProfile;
  uploadArtifacts?: boolean;
  skipBundleBuild?: boolean;
  quiet?: boolean;
  onStep?: (message: string) => void;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
}
