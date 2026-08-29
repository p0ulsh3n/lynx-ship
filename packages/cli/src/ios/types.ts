import type { BuildProfile } from "../config.js";

export interface IosBuildOptions {
  root: string;
  profile: BuildProfile;
  uploadArtifacts?: boolean;
  simulator?: boolean;
  simulatorDevice?: string;
  simulatorAutostart?: boolean;
  skipBundleBuild?: boolean;
  quiet?: boolean;
  onEvent?: (message: string) => void;
  onProgress?: (value?: number, label?: string) => void;
}
