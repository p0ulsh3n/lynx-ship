import type { MediaKind } from "../dist/contracts.js";

export interface LynxShipMediaModule {
  getCapabilities(callback: (capabilities: string) => void): void;
  requestAccess(kind: MediaKind, callback: (granted: boolean) => void): void;
  pick(
    kind: "photo-library" | "video-library",
    callback: (uri: string) => void,
  ): void;
  capture(kind: "camera" | "microphone", callback: (uri: string) => void): void;
  chooseMedia?(request: string, callback: (result: string) => void): void;
  uploadFile?(request: string, callback: (result: string) => void): void;
  uploadImage?(request: string, callback: (result: string) => void): void;
  downloadFile?(request: string, callback: (result: string) => void): void;
  saveDataURL?(request: string, callback: (result: string) => void): void;
}
