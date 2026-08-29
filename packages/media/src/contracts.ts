export type MediaKind =
  | "camera"
  | "microphone"
  | "photo-library"
  | "video-library";

export type MediaCapability = "enumerate" | "capture" | "pick";

export interface MediaDevice {
  readonly id: string;
  readonly kind: "camera" | "microphone";
  readonly label?: string;
  readonly facing?: "front" | "back" | "external";
}

export interface MediaAdapter {
  has(kind: MediaKind, capability: MediaCapability): boolean;
  requestAccess(kind: MediaKind): Promise<boolean>;
  listDevices?(): Promise<readonly MediaDevice[]>;
  capture?(options: {
    kind: "camera" | "microphone";
    deviceId?: string;
  }): Promise<unknown>;
  /** Start a microphone recording and keep it owned by the native adapter. */
  startRecording?(): Promise<void>;
  /** Stop the active recording and return its app-scoped URI. */
  stopRecording?(): Promise<string>;
  pick?(options: { kind: "photo-library" | "video-library" }): Promise<unknown>;
}

export interface MediaClient {
  has(kind: MediaKind, capability: MediaCapability): boolean;
  requestAccess(kind: MediaKind): Promise<boolean>;
  listDevices(): Promise<readonly MediaDevice[]>;
  capture(options: {
    kind: "camera" | "microphone";
    deviceId?: string;
  }): Promise<unknown>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<string>;
  pick(options: { kind: "photo-library" | "video-library" }): Promise<unknown>;
}

export class MediaCapabilityError extends Error {
  public readonly code = "MEDIA_CAPABILITY_UNAVAILABLE";

  public constructor(message: string) {
    super(message);
    this.name = "MediaCapabilityError";
  }
}
