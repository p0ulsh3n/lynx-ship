import {
  MediaCapabilityError,
  type MediaAdapter,
  type MediaDataUrlRequest,
  type MediaDownloadRequest,
  type MediaDownloadResult,
  type MediaFileRequest,
  type MediaUploadResult,
} from "./contracts.js";
import {
  validateMediaHeaders,
  validateMediaTransferURL,
} from "./transfer-validation.js";
import {
  validateMediaDownloadResult,
  validateMediaUploadResult,
} from "./transfer-results.js";

export const DEFAULT_MEDIA_TRANSFER_MAX_BYTES = 100 * 1024 * 1024;

export const DEFAULT_MEDIA_TRANSFER_TIMEOUT_MS = 30_000;

export const MAX_MEDIA_TRANSFER_TIMEOUT_MS = 5 * 60_000;

export interface MediaTransferMethods {
  uploadFile(request: MediaFileRequest): Promise<MediaUploadResult>;
  uploadImage(request: MediaFileRequest): Promise<MediaUploadResult>;
  downloadFile(request: MediaDownloadRequest): Promise<MediaDownloadResult>;
  saveDataURL(request: MediaDataUrlRequest): Promise<MediaDownloadResult>;
}

const EXTENSION = /^[A-Za-z0-9]{1,16}$/;
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function invalid(message: string): MediaCapabilityError {
  return new MediaCapabilityError(message);
}

function validateParams(
  params: Readonly<Record<string, string | number | boolean>> | undefined,
): Readonly<Record<string, string | number | boolean>> {
  const normalized: Record<string, string | number | boolean> = {};
  const values = Object.entries(params ?? {});
  if (values.length > 64)
    throw invalid("Media transfer params are limited to 64 entries.");
  for (const [key, value] of values) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key))
      throw invalid("Media transfer parameter names are invalid.");
    if (
      !["string", "number", "boolean"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw invalid("Media transfer parameters must be finite primitives.");
    normalized[key] = value;
  }
  return Object.freeze(normalized);
}

function limit(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > fallback)
    throw invalid(`${label} must be an integer between 1 and ${fallback}.`);
  return result;
}

function resolveFileUri(request: MediaFileRequest): string {
  if (
    request.fileUri &&
    request.filePath &&
    request.fileUri !== request.filePath
  )
    throw invalid("Specify only one media file URI (fileUri or filePath).");
  const fileUri = request.fileUri ?? request.filePath;
  if (
    typeof fileUri !== "string" ||
    fileUri.length === 0 ||
    fileUri.length > 4096
  )
    throw invalid("Media file URI is invalid.");
  if (!/^(?:file|content|app|blob):/i.test(fileUri))
    throw invalid(
      "Media file URI must be app-scoped (file, content, app or blob).",
    );
  return fileUri;
}

function resolveHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  header: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (headers && header && JSON.stringify(headers) !== JSON.stringify(header))
    throw invalid("Specify only one media header map (headers or header).");
  return validateMediaHeaders(headers ?? header);
}

function resolveTimeoutMs(request: {
  timeoutMs?: number;
  timeoutInterval?: number;
}): number {
  if (request.timeoutMs !== undefined && request.timeoutInterval !== undefined)
    throw invalid(
      "Specify only one media timeout (timeoutMs or timeoutInterval).",
    );
  if (request.timeoutInterval !== undefined) {
    if (
      !Number.isFinite(request.timeoutInterval) ||
      request.timeoutInterval <= 0
    )
      throw invalid("timeoutInterval must be a positive number of seconds.");
    const milliseconds = Math.round(request.timeoutInterval * 1000);
    if (milliseconds < 1 || milliseconds > MAX_MEDIA_TRANSFER_TIMEOUT_MS)
      throw invalid(
        `timeoutInterval must be between 0 and ${MAX_MEDIA_TRANSFER_TIMEOUT_MS / 1000} seconds.`,
      );
    return milliseconds;
  }
  return limit(
    request.timeoutMs,
    DEFAULT_MEDIA_TRANSFER_TIMEOUT_MS,
    "timeoutMs",
  );
}

export function validateMediaFileRequest(
  request: MediaFileRequest,
): MediaFileRequest {
  const fileUri = resolveFileUri(request);
  const headers = resolveHeaders(request.headers, request.header);
  const timeoutMs = resolveTimeoutMs(request);
  return Object.freeze({
    ...request,
    fileUri,
    filePath: fileUri,
    url: validateMediaTransferURL(request.url),
    headers,
    header: headers,
    params: validateParams(request.params),
    timeoutMs,
    maxBytes: limit(
      request.maxBytes,
      DEFAULT_MEDIA_TRANSFER_MAX_BYTES,
      "maxBytes",
    ),
  });
}

export function validateMediaDownloadRequest(
  request: MediaDownloadRequest,
): MediaDownloadRequest {
  if (!EXTENSION.test(request.extension))
    throw invalid("Media download extension is invalid.");
  const headers = resolveHeaders(request.headers, request.header);
  const timeoutMs = resolveTimeoutMs(request);
  return Object.freeze({
    ...request,
    url: validateMediaTransferURL(request.url),
    headers,
    header: headers,
    params: validateParams(request.params),
    timeoutMs,
    maxBytes: limit(
      request.maxBytes,
      DEFAULT_MEDIA_TRANSFER_MAX_BYTES,
      "maxBytes",
    ),
  });
}

export function validateMediaDataURLRequest(
  request: MediaDataUrlRequest,
): MediaDataUrlRequest {
  if (!/^data:[^;,\s]+;base64,[A-Za-z0-9+/=]*$/i.test(request.dataURL))
    throw invalid("Only base64 data URLs are accepted.");
  if (!FILENAME.test(request.filename) || !EXTENSION.test(request.extension))
    throw invalid("Media output filename or extension is invalid.");
  const payload = request.dataURL.slice(request.dataURL.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((payload.length * 3) / 4) - padding;
  const maxBytes = limit(
    request.maxBytes,
    DEFAULT_MEDIA_TRANSFER_MAX_BYTES,
    "maxBytes",
  );
  if (bytes > maxBytes)
    throw invalid("Media data URL exceeds the configured size limit.");
  return Object.freeze({ ...request, maxBytes });
}

export {
  validateMediaHeaders,
  validateMediaTransferURL,
} from "./transfer-validation.js";

export {
  validateMediaDownloadResult,
  validateMediaUploadResult,
} from "./transfer-results.js";

export function createMediaTransferMethods(
  adapter: MediaAdapter,
): MediaTransferMethods {
  return {
    uploadFile: async (request) => {
      const method = adapter.uploadFile;
      if (!method)
        throw new MediaCapabilityError(
          "The host did not provide media uploadFile().",
        );
      const validated = validateMediaFileRequest(request);
      return validateMediaUploadResult(await method(validated));
    },
    uploadImage: async (request) => {
      const method = adapter.uploadImage;
      if (!method)
        throw new MediaCapabilityError(
          "The host did not provide media uploadImage().",
        );
      const validated = validateMediaFileRequest(request);
      return validateMediaUploadResult(await method(validated));
    },
    downloadFile: async (request) => {
      const method = adapter.downloadFile;
      if (!method)
        throw new MediaCapabilityError(
          "The host did not provide media downloadFile().",
        );
      const validated = validateMediaDownloadRequest(request);
      return validateMediaDownloadResult(
        await method(validated),
        validated.maxBytes,
      );
    },
    saveDataURL: async (request) => {
      const method = adapter.saveDataURL;
      if (!method)
        throw new MediaCapabilityError(
          "The host did not provide media saveDataURL().",
        );
      const validated = validateMediaDataURLRequest(request);
      return validateMediaDownloadResult(
        await method(validated),
        validated.maxBytes,
      );
    },
  };
}

export type MediaTransferResult = MediaUploadResult | MediaDownloadResult;
