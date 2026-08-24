import { randomUUID } from "node:crypto";

export type NativeArtifactExtension = "apk" | "aab" | "ipa";

export function nativeArtifactName(extension: NativeArtifactExtension): string {
  return `${randomUUID()}.${extension}`;
}
