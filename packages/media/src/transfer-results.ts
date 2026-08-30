import {
  type MediaDownloadResult,
  type MediaUploadResult,
} from "./contracts.js";
import {
  invalidMediaTransfer,
  validateMediaHeaders,
  validateMediaTransferURL,
} from "./transfer-validation.js";

const MAX_MEDIA_TRANSFER_RESPONSE_BYTES = 256 * 1024;

function validateStatus(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 100 ||
    value > 599
  )
    throw invalidMediaTransfer(
      `${label} must be an HTTP status between 100 and 599.`,
    );
  return value;
}

function validateOptionalCode(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < -1_000_000 ||
    value > 1_000_000
  )
    throw invalidMediaTransfer(`${label} must be a bounded integer.`);
  return value;
}

function validateReference(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096)
    throw invalidMediaTransfer(`${label} is invalid.`);
  if (/[\r\n]/.test(value))
    throw invalidMediaTransfer(`${label} must not contain line breaks.`);
  return value;
}

function validateResponseBody(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      serialized.length > MAX_MEDIA_TRANSFER_RESPONSE_BYTES
    )
      throw invalidMediaTransfer(
        "Media transfer response is too large or not JSON-serializable.",
      );
  } catch (error) {
    if (error instanceof Error && error.name === "MediaCapabilityError")
      throw error;
    throw invalidMediaTransfer(
      "Media transfer response is not JSON-serializable.",
    );
  }
  return value;
}

function validateResultHeaders(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalidMediaTransfer("Media transfer headers must be an object.");
  for (const headerValue of Object.values(value))
    if (typeof headerValue !== "string")
      throw invalidMediaTransfer("Media transfer header values are invalid.");
  return validateMediaHeaders(value as Record<string, string>);
}

export function validateMediaUploadResult(value: unknown): MediaUploadResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalidMediaTransfer("Media upload result must be an object.");
  const result = value as Record<string, unknown>;
  const status = validateStatus(result.status, "Media upload status");
  const httpCode = validateOptionalCode(
    result.httpCode,
    "Media upload httpCode",
  );
  const clientCode = validateOptionalCode(
    result.clientCode,
    "Media upload clientCode",
  );
  const uri = validateReference(result.uri, "Media upload URI");
  const url = validateReference(result.url, "Media upload URL");
  if (url !== undefined) validateMediaTransferURL(url);
  const filePath = validateReference(result.filePath, "Media upload filePath");
  if (filePath !== undefined && !/^(?:file|content|app|blob):/i.test(filePath))
    throw invalidMediaTransfer("Media upload filePath must be app-scoped.");
  const header = validateResultHeaders(result.header);
  const response = validateResponseBody(result.response);
  return Object.freeze({
    status,
    ...(httpCode === undefined ? {} : { httpCode }),
    ...(clientCode === undefined ? {} : { clientCode }),
    ...(uri === undefined ? {} : { uri }),
    ...(url === undefined ? {} : { url }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(header === undefined ? {} : { header }),
    ...(response === undefined ? {} : { response }),
  });
}

export function validateMediaDownloadResult(
  value: unknown,
  maxBytes = 100 * 1024 * 1024,
): MediaDownloadResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalidMediaTransfer("Media download result must be an object.");
  const result = value as Record<string, unknown>;
  const status = validateStatus(result.status, "Media download status");
  const httpCode = validateOptionalCode(
    result.httpCode,
    "Media download httpCode",
  );
  const clientCode = validateOptionalCode(
    result.clientCode,
    "Media download clientCode",
  );
  const fileUri = validateReference(result.fileUri, "Media download fileUri");
  const filePath = validateReference(
    result.filePath,
    "Media download filePath",
  );
  if (fileUri && filePath && fileUri !== filePath)
    throw invalidMediaTransfer(
      "Media download fileUri and filePath must match.",
    );
  const canonicalUri = fileUri ?? filePath;
  if (!canonicalUri || !/^(?:file|content|app|blob):/i.test(canonicalUri))
    throw invalidMediaTransfer("Media download fileUri must be app-scoped.");
  const bytes = result.bytes;
  if (
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > maxBytes
  )
    throw invalidMediaTransfer(
      `Media download bytes must be between 0 and ${maxBytes}.`,
    );
  const contentType = validateReference(
    result.contentType,
    "Media download contentType",
  );
  const header = validateResultHeaders(result.header);
  return Object.freeze({
    status,
    ...(httpCode === undefined ? {} : { httpCode }),
    ...(clientCode === undefined ? {} : { clientCode }),
    fileUri: canonicalUri,
    filePath: canonicalUri,
    bytes,
    ...(contentType === undefined ? {} : { contentType }),
    ...(header === undefined ? {} : { header }),
  });
}
