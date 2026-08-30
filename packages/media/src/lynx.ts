import {
  MediaCapabilityError,
  type MediaDataUrlRequest,
  type MediaDownloadRequest,
  type MediaDownloadResult,
  type MediaFileRequest,
  type MediaClient,
  type MediaKind,
  type MediaSelectionOptions,
  type MediaSelectionResult,
  type MediaUploadResult,
} from "./contracts.js";
import {
  validateMediaDataURLRequest,
  validateMediaDownloadRequest,
  validateMediaDownloadResult,
  validateMediaFileRequest,
  validateMediaUploadResult,
} from "./transfer.js";
import {
  validateMediaSelectionOptions,
  validateMediaSelectionResult,
} from "./selection.js";

export interface LynxMediaModule {
  getCapabilities(callback: (capabilities: string) => void): void;
  requestAccess(kind: MediaKind, callback: (granted: boolean) => void): void;
  pick(
    kind: "photo-library" | "video-library",
    callback: (uri: string) => void,
  ): void;
  chooseMedia?(request: string, callback: (result: string) => void): void;
  capture(kind: "camera" | "microphone", callback: (uri: string) => void): void;
  startRecording?(callback: (started: boolean) => void): void;
  stopRecording?(callback: (uri: string) => void): void;
  uploadFile?(request: string, callback: (result: string) => void): void;
  uploadImage?(request: string, callback: (result: string) => void): void;
  downloadFile?(request: string, callback: (result: string) => void): void;
  saveDataURL?(request: string, callback: (result: string) => void): void;
}

/** Resolve the native module at call time so Node and Web imports stay safe. */
export function getLynxMediaModule(): LynxMediaModule {
  const nativeModules = (
    globalThis as typeof globalThis & {
      NativeModules?: Record<string, unknown>;
    }
  ).NativeModules;
  const module = nativeModules?.LynxShipMedia;
  if (!module || typeof module !== "object")
    throw new MediaCapabilityError(
      "LynxShipMedia native module is not linked.",
    );
  const candidate = module as Partial<LynxMediaModule>;
  if (
    typeof candidate.pick !== "function" ||
    typeof candidate.capture !== "function"
  )
    throw new MediaCapabilityError(
      "LynxShipMedia native module is incomplete.",
    );
  return candidate as LynxMediaModule;
}

export function createLynxMediaClient(
  module = getLynxMediaModule(),
): MediaClient {
  const capabilities = {
    pickPhoto: false,
    pickVideo: false,
    capturePhoto: false,
    recordAudio: false,
  };
  try {
    module.getCapabilities?.((value) => {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        for (const key of Object.keys(capabilities) as Array<
          keyof typeof capabilities
        >)
          if (typeof parsed[key] === "boolean")
            capabilities[key] = parsed[key] as boolean;
      } catch {
        // Invalid native capability data is treated as unsupported.
      }
    });
  } catch {
    // Capability discovery is best effort; the explicit defaults stay safe.
  }
  return {
    has: (kind, capability) =>
      hasNativeCapability(kind, capability, capabilities),
    requestAccess: (kind) => requestNativeAccess(module, kind, capabilities),
    listDevices: async () => {
      requireNativeCapability("camera", "enumerate", capabilities);
      throw new MediaCapabilityError(
        "The native media module does not expose device enumeration.",
      );
    },
    capture: async (options) => {
      requireNativeCapability(options.kind, "capture", capabilities);
      return callUri(
        (callback) => module.capture(options.kind, callback),
        "capture",
      );
    },
    pick: async (options) => {
      requireNativeCapability(options.kind, "pick", capabilities);
      return callUri(
        (callback) => module.pick(options.kind, callback),
        "selection",
      );
    },
    chooseMedia: (options) =>
      callSelection(module, validateMediaSelectionOptions(options)),
    startRecording: () => startNativeRecording(module, capabilities),
    stopRecording: () => stopNativeRecording(module, capabilities),
    uploadFile: (request) =>
      callTransfer(module, "uploadFile", validateMediaFileRequest(request)),
    uploadImage: (request) =>
      callTransfer(module, "uploadImage", validateMediaFileRequest(request)),
    downloadFile: (request) =>
      callTransfer(
        module,
        "downloadFile",
        validateMediaDownloadRequest(request),
      ),
    saveDataURL: (request) =>
      callTransfer(module, "saveDataURL", validateMediaDataURLRequest(request)),
  };
}

function callSelection(
  module: LynxMediaModule,
  options: MediaSelectionOptions,
): Promise<MediaSelectionResult> {
  if (typeof module.chooseMedia !== "function")
    return Promise.reject(
      new MediaCapabilityError(
        "The native media module does not support chooseMedia().",
      ),
    );
  return new Promise((resolve, reject) => {
    try {
      module.chooseMedia!(JSON.stringify(options), (raw) => {
        try {
          const result = JSON.parse(raw) as {
            code?: number;
            data?: MediaSelectionResult;
            msg?: string;
          };
          if (result.code !== 1 || !result.data)
            throw new Error(result.msg ?? "Media selection failed.");
          resolve(validateMediaSelectionResult(result.data));
        } catch (error) {
          reject(
            new MediaCapabilityError(
              error instanceof Error
                ? error.message
                : "Media selection failed.",
            ),
          );
        }
      });
    } catch (error) {
      reject(
        new MediaCapabilityError(
          error instanceof Error ? error.message : "Media selection failed.",
        ),
      );
    }
  });
}

type TransferCallback = (
  request: string,
  callback: (result: string) => void,
) => void;

function callTransfer(
  module: LynxMediaModule,
  operation: "uploadFile" | "uploadImage",
  request: MediaFileRequest,
): Promise<MediaUploadResult>;
function callTransfer(
  module: LynxMediaModule,
  operation: "downloadFile" | "saveDataURL",
  request: MediaDownloadRequest | MediaDataUrlRequest,
): Promise<MediaDownloadResult>;
function callTransfer(
  module: LynxMediaModule,
  operation: "uploadFile" | "uploadImage" | "downloadFile" | "saveDataURL",
  request: MediaFileRequest | MediaDownloadRequest | MediaDataUrlRequest,
): Promise<MediaUploadResult | MediaDownloadResult> {
  const invoke = module[operation] as TransferCallback | undefined;
  if (!invoke)
    return Promise.reject(
      new MediaCapabilityError(
        `The native media module does not support ${operation}().`,
      ),
    );
  return new Promise((resolve, reject) => {
    try {
      invoke(JSON.stringify(request), (raw) => {
        try {
          const result = JSON.parse(raw) as {
            code?: number;
            data?: unknown;
            msg?: string;
          };
          if (result.code !== 1 || !result.data)
            throw new Error(result.msg ?? `Media ${operation} failed.`);
          if (operation === "uploadFile" || operation === "uploadImage")
            resolve(validateMediaUploadResult(result.data));
          else
            resolve(validateMediaDownloadResult(result.data, request.maxBytes));
        } catch (error) {
          reject(
            new MediaCapabilityError(
              error instanceof Error
                ? error.message
                : `Media ${operation} failed.`,
            ),
          );
        }
      });
    } catch (error) {
      reject(
        new MediaCapabilityError(
          error instanceof Error ? error.message : `Media ${operation} failed.`,
        ),
      );
    }
  });
}

function requireNativeCapability(
  kind: MediaKind,
  capability: "enumerate" | "capture" | "pick",
  capabilities: Parameters<typeof hasNativeCapability>[2],
): void {
  if (!hasNativeCapability(kind, capability, capabilities))
    throw new MediaCapabilityError(
      `The native host does not support '${capability}' for '${kind}'.`,
    );
}

function hasNativeCapability(
  kind: MediaKind,
  capability: "enumerate" | "capture" | "pick",
  capabilities: {
    pickPhoto: boolean;
    pickVideo: boolean;
    capturePhoto: boolean;
    recordAudio: boolean;
  },
): boolean {
  if (capability === "pick")
    return kind === "photo-library"
      ? capabilities.pickPhoto
      : kind === "video-library"
        ? capabilities.pickVideo
        : false;
  if (capability === "capture")
    return kind === "camera"
      ? capabilities.capturePhoto
      : capabilities.recordAudio;
  return false;
}

function requestNativeAccess(
  module: LynxMediaModule,
  kind: MediaKind,
  capabilities: Parameters<typeof hasNativeCapability>[2],
): Promise<boolean> {
  const capability =
    kind === "camera" || kind === "microphone" ? "capture" : "pick";
  if (!hasNativeCapability(kind, capability, capabilities))
    return Promise.resolve(false);
  if (typeof module.requestAccess !== "function") return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      module.requestAccess(kind, resolve);
    } catch {
      resolve(false);
    }
  });
}

function callUri(
  invoke: (callback: (uri: string) => void) => void,
  operation: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      invoke((uri) => {
        const normalized = typeof uri === "string" ? uri.trim() : "";
        normalized
          ? resolve(normalized)
          : reject(
              new MediaCapabilityError(
                `Media ${operation} was cancelled or unavailable.`,
              ),
            );
      });
    } catch (error) {
      reject(
        error instanceof MediaCapabilityError
          ? error
          : new MediaCapabilityError(`Media ${operation} failed.`),
      );
    }
  });
}

function startNativeRecording(
  module: LynxMediaModule,
  capabilities: Parameters<typeof hasNativeCapability>[2],
): Promise<void> {
  if (!capabilities.recordAudio || typeof module.startRecording !== "function")
    return Promise.reject(
      new MediaCapabilityError(
        "The native media module does not support lifecycle audio recording.",
      ),
    );
  return new Promise((resolve, reject) => {
    try {
      module.startRecording!((started) => {
        started
          ? resolve()
          : reject(
              new MediaCapabilityError("Media recording could not start."),
            );
      });
    } catch {
      reject(new MediaCapabilityError("Media recording could not start."));
    }
  });
}

function stopNativeRecording(
  module: LynxMediaModule,
  capabilities: Parameters<typeof hasNativeCapability>[2],
): Promise<string> {
  if (!capabilities.recordAudio || typeof module.stopRecording !== "function")
    return Promise.reject(
      new MediaCapabilityError(
        "The native media module does not support lifecycle audio recording.",
      ),
    );
  return callUri(
    (callback) => module.stopRecording!(callback),
    "recording stop",
  );
}
