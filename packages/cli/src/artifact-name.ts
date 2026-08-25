import { randomUUID } from "node:crypto";

export type NativeArtifactExtension =
  | "apk"
  | "aab"
  | "ipa"
  | "hap"
  | "lynx.bundle"
  | "web.bundle"
  | "app"
  | "dmg"
  | "exe"
  | "appimage"
  | "zip";

export function nativeArtifactName(extension: NativeArtifactExtension): string {
  return `${randomUUID()}.${extension}`;
}
