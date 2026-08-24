import { hashJson } from "@lynxship/contracts";

export interface RuntimeConfig {
  update?: { protocolVersion?: number };
}

export interface NativeInputs {
  engine?: string;
  sdk?: string;
  xcode?: string;
  androidApi?: number | string;
  gradle?: string;
  nativeHash?: string;
  modulesHash?: string;
}

export interface RuntimeFingerprintInput {
  platform: string;
  config?: RuntimeConfig;
  packageManager?: string;
  lockfileHash?: string;
  native?: NativeInputs;
}

export function runtimeFingerprint(input: RuntimeFingerprintInput): {
  value: string;
  inputs: Record<string, unknown>;
} {
  const native = input.native ?? {};
  const inputs = {
    platform: input.platform,
    protocolVersion: input.config?.update?.protocolVersion ?? 1,
    packageManager: input.packageManager ?? "unknown",
    lockfileHash: input.lockfileHash ?? "none",
    native: {
      engine: native.engine ?? "unknown",
      sdk: native.sdk ?? "unknown",
      xcode: native.xcode ?? "unknown",
      androidApi: native.androidApi ?? "unknown",
      gradle: native.gradle ?? "unknown",
      nativeHash: native.nativeHash ?? "none",
      modulesHash: native.modulesHash ?? "none",
    },
  };
  return { value: `fp-${hashJson(inputs).slice(0, 24)}`, inputs };
}
