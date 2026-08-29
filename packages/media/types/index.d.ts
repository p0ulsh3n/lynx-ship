import type { MediaKind } from "../dist/contracts.js";

export interface LynxShipMediaModule {
  getCapabilities(callback: (capabilities: string) => void): void;
  requestAccess(kind: MediaKind, callback: (granted: boolean) => void): void;
  pick(
    kind: "photo-library" | "video-library",
    callback: (uri: string) => void,
  ): void;
  capture(kind: "camera" | "microphone", callback: (uri: string) => void): void;
}
