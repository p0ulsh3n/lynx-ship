export type MediaKind =
  | "camera"
  | "microphone"
  | "photo-library"
  | "video-library";

export type MediaCapability = "enumerate" | "capture" | "pick";

export type MediaSelectionType = "image" | "video";

export type MediaSelectionSource = "album" | "camera";

export type MediaCameraType = "front" | "back";

export interface MediaSelectionOptions {
  readonly mediaTypes: readonly MediaSelectionType[];
  readonly sourceType: MediaSelectionSource;
  readonly maxCount?: number;
  readonly cameraType?: MediaCameraType;
  readonly compressImage?: boolean;
  readonly saveToPhotoAlbum?: boolean;
  readonly needBase64Data?: boolean;
  readonly compressOption?: 0 | 1 | 2 | 3 | 4;
  readonly compressWidth?: number;
  readonly compressHeight?: number;
  readonly compressQuality?: number;
}

export interface MediaTempFile {
  readonly tempFilePath: string;
  readonly tempFileAbsolutePath: string;
  readonly size: number;
  readonly mediaType: MediaSelectionType;
  readonly mimeType: string;
  readonly base64Data?: string;
}

export interface MediaSelectionResult {
  readonly tempFiles: readonly MediaTempFile[];
}

export interface MediaTransferRequest {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sparkling-compatible alias for headers. */
  readonly header?: Readonly<Record<string, string>>;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  readonly timeoutMs?: number;
  /** Sparkling-compatible timeout in seconds. */
  readonly timeoutInterval?: number;
  readonly maxBytes?: number;
}

export interface MediaFileRequest {
  /** LynxShip canonical local URI. */
  readonly fileUri?: string;
  /** Sparkling-compatible alias for fileUri. */
  readonly filePath?: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sparkling-compatible alias for headers. */
  readonly header?: Readonly<Record<string, string>>;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  readonly timeoutMs?: number;
  /** Sparkling-compatible timeout in seconds. */
  readonly timeoutInterval?: number;
  readonly maxBytes?: number;
}

export interface MediaUploadResult {
  readonly status: number;
  readonly httpCode?: number;
  readonly clientCode?: number;
  readonly uri?: string;
  readonly url?: string;
  readonly filePath?: string;
  readonly header?: Readonly<Record<string, string>>;
  readonly response?: unknown;
}

export interface MediaDownloadRequest extends MediaTransferRequest {
  readonly extension: string;
  readonly saveToAlbum?: "image" | "video";
}

export interface MediaDownloadResult {
  readonly status: number;
  readonly httpCode?: number;
  readonly clientCode?: number;
  readonly fileUri: string;
  readonly filePath?: string;
  readonly bytes: number;
  readonly contentType?: string;
  readonly header?: Readonly<Record<string, string>>;
}

export interface MediaDataUrlRequest {
  readonly dataURL: string;
  readonly filename: string;
  readonly extension: string;
  readonly saveToAlbum?: "image" | "video";
  readonly maxBytes?: number;
}

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
  /** Unified album/camera image/video selection, including native transforms. */
  chooseMedia?(options: MediaSelectionOptions): Promise<MediaSelectionResult>;
  uploadFile?(request: MediaFileRequest): Promise<MediaUploadResult>;
  uploadImage?(request: MediaFileRequest): Promise<MediaUploadResult>;
  downloadFile?(request: MediaDownloadRequest): Promise<MediaDownloadResult>;
  saveDataURL?(request: MediaDataUrlRequest): Promise<MediaDownloadResult>;
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
  chooseMedia(options: MediaSelectionOptions): Promise<MediaSelectionResult>;
  uploadFile(request: MediaFileRequest): Promise<MediaUploadResult>;
  uploadImage(request: MediaFileRequest): Promise<MediaUploadResult>;
  downloadFile(request: MediaDownloadRequest): Promise<MediaDownloadResult>;
  saveDataURL(request: MediaDataUrlRequest): Promise<MediaDownloadResult>;
}

export class MediaCapabilityError extends Error {
  public readonly code = "MEDIA_CAPABILITY_UNAVAILABLE";

  public constructor(message: string) {
    super(message);
    this.name = "MediaCapabilityError";
  }
}
