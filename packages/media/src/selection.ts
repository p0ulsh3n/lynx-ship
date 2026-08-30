import { MediaCapabilityError } from "./contracts.js";
import type {
  MediaAdapter,
  MediaClient,
  MediaSelectionOptions,
  MediaSelectionResult,
} from "./contracts.js";

export const DEFAULT_MEDIA_SELECTION_MAX_COUNT = 1;

export const MAX_MEDIA_SELECTION_COUNT = 100;

export const MAX_MEDIA_DIMENSION = 8192;

const MEDIA_TYPES = ["image", "video"] as const;
const SOURCES = ["album", "camera"] as const;
const CAMERA_TYPES = ["front", "back"] as const;

function selectionError(message: string): MediaCapabilityError {
  return new MediaCapabilityError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isMediaType(value: unknown): value is (typeof MEDIA_TYPES)[number] {
  return (
    typeof value === "string" &&
    (MEDIA_TYPES as readonly string[]).includes(value)
  );
}

function isSource(value: unknown): value is (typeof SOURCES)[number] {
  return (
    typeof value === "string" && (SOURCES as readonly string[]).includes(value)
  );
}

function isCameraType(value: unknown): value is (typeof CAMERA_TYPES)[number] {
  return (
    typeof value === "string" &&
    (CAMERA_TYPES as readonly string[]).includes(value)
  );
}

function validateBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw selectionError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  return value;
}

function validateBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw selectionError(`${field} must be a boolean.`);
  return value;
}

function validateMediaTypes(value: unknown): readonly ("image" | "video")[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MEDIA_TYPES.length
  )
    throw selectionError(
      "mediaTypes must contain one or both supported media types.",
    );
  const types = value.map((entry) => {
    if (!isMediaType(entry))
      throw selectionError("mediaTypes contains an unsupported type.");
    return entry;
  });
  if (new Set(types).size !== types.length)
    throw selectionError("mediaTypes must not contain duplicates.");
  return types;
}

/** Validate and normalize the cross-platform chooseMedia request. */
export function validateMediaSelectionOptions(
  input: MediaSelectionOptions,
): MediaSelectionOptions {
  if (!isRecord(input))
    throw selectionError("Media selection options must be an object.");
  if (!isSource(input.sourceType))
    throw selectionError("sourceType must be 'album' or 'camera'.");

  const mediaTypes = validateMediaTypes(input.mediaTypes);
  const maxCount =
    input.maxCount === undefined
      ? DEFAULT_MEDIA_SELECTION_MAX_COUNT
      : validateBoundedInteger(
          input.maxCount,
          "maxCount",
          1,
          MAX_MEDIA_SELECTION_COUNT,
        );
  const cameraType = input.cameraType;
  if (input.sourceType === "camera") {
    if (!isCameraType(cameraType))
      throw selectionError("cameraType is required for camera selection.");
    if (maxCount !== 1)
      throw selectionError(
        "Camera selection supports exactly one item at a time.",
      );
  } else if (cameraType !== undefined) {
    throw selectionError(
      "cameraType is only valid when sourceType is 'camera'.",
    );
  }

  const compressImage = input.compressImage ?? false;
  const saveToPhotoAlbum = input.saveToPhotoAlbum ?? false;
  const needBase64Data = input.needBase64Data ?? false;
  validateBoolean(compressImage, "compressImage");
  validateBoolean(saveToPhotoAlbum, "saveToPhotoAlbum");
  validateBoolean(needBase64Data, "needBase64Data");

  const compressOption = input.compressOption ?? 0;
  validateBoundedInteger(compressOption, "compressOption", 0, 4);
  const compressWidth = input.compressWidth ?? 0;
  const compressHeight = input.compressHeight ?? 0;
  validateBoundedInteger(
    compressWidth,
    "compressWidth",
    0,
    MAX_MEDIA_DIMENSION,
  );
  validateBoundedInteger(
    compressHeight,
    "compressHeight",
    0,
    MAX_MEDIA_DIMENSION,
  );
  const compressQuality = input.compressQuality ?? 100;
  validateBoundedInteger(compressQuality, "compressQuality", 0, 100);

  return Object.freeze({
    mediaTypes: Object.freeze([...mediaTypes]),
    sourceType: input.sourceType,
    maxCount,
    ...(cameraType === undefined ? {} : { cameraType }),
    compressImage,
    saveToPhotoAlbum,
    needBase64Data,
    compressOption,
    compressWidth,
    compressHeight,
    compressQuality,
  });
}

/** Validate a native chooseMedia result before exposing it to application code. */
export function validateMediaSelectionResult(
  input: MediaSelectionResult,
): MediaSelectionResult {
  if (!isRecord(input) || !Array.isArray(input.tempFiles))
    throw selectionError(
      "Media selection result must contain a tempFiles array.",
    );
  if (input.tempFiles.length > MAX_MEDIA_SELECTION_COUNT)
    throw selectionError("Media selection returned too many files.");
  const tempFiles = input.tempFiles.map((file, index) => {
    if (!isRecord(file))
      throw selectionError(`tempFiles[${index}] must be an object.`);
    const path = file.tempFilePath;
    const absolutePath = file.tempFileAbsolutePath;
    if (typeof path !== "string" || path.length === 0 || path.length > 4096)
      throw selectionError(`tempFiles[${index}].tempFilePath is invalid.`);
    if (
      typeof absolutePath !== "string" ||
      absolutePath.length === 0 ||
      absolutePath.length > 4096
    )
      throw selectionError(
        `tempFiles[${index}].tempFileAbsolutePath is invalid.`,
      );
    if (!isMediaType(file.mediaType))
      throw selectionError(`tempFiles[${index}].mediaType is invalid.`);
    if (
      typeof file.mimeType !== "string" ||
      file.mimeType.length === 0 ||
      file.mimeType.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(file.mimeType)
    )
      throw selectionError(`tempFiles[${index}].mimeType is invalid.`);
    const size = validateBoundedInteger(
      file.size,
      `tempFiles[${index}].size`,
      0,
      100 * 1024 * 1024,
    );
    const base64Data = file.base64Data;
    if (
      base64Data !== undefined &&
      (typeof base64Data !== "string" || base64Data.length > 140 * 1024 * 1024)
    )
      throw selectionError(
        `tempFiles[${index}].base64Data is invalid or too large.`,
      );
    return Object.freeze({
      tempFilePath: path,
      tempFileAbsolutePath: absolutePath,
      size,
      mediaType: file.mediaType,
      mimeType: file.mimeType,
      ...(base64Data === undefined ? {} : { base64Data }),
    });
  });
  return Object.freeze({ tempFiles: Object.freeze(tempFiles) });
}

export function createMediaSelectionMethods(
  adapter: MediaAdapter,
): Pick<MediaClient, "chooseMedia"> {
  return {
    chooseMedia: async (options) => {
      const normalized = validateMediaSelectionOptions(options);
      if (!adapter.chooseMedia)
        throw new Error("The host did not provide chooseMedia().");
      return validateMediaSelectionResult(
        await adapter.chooseMedia(normalized),
      );
    },
  };
}
