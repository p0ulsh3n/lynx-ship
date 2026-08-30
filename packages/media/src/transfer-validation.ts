import { MediaCapabilityError } from "./contracts.js";

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function invalidMediaTransfer(message: string): MediaCapabilityError {
  return new MediaCapabilityError(message);
}

export function validateMediaTransferURL(value: string): string {
  let url: URL;
  if (typeof value !== "string")
    throw invalidMediaTransfer("Media transfer URL must be a valid HTTPS URL.");
  try {
    url = new URL(value);
  } catch {
    throw invalidMediaTransfer("Media transfer URL must be a valid HTTPS URL.");
  }
  const local = LOCAL_HOSTS.has(url.hostname.replace(/[\[\]]/g, ""));
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw invalidMediaTransfer("Media transfer URL must use HTTPS.");
  if (url.username || url.password)
    throw invalidMediaTransfer(
      "Media transfer credentials must not be placed in the URL.",
    );
  return url.toString();
}

export function validateMediaHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  const values = Object.entries(headers ?? {});
  if (values.length > 64)
    throw invalidMediaTransfer(
      "Media transfer headers are limited to 64 entries.",
    );
  for (const [name, value] of values) {
    if (!HEADER_NAME.test(name) || name.length > 128)
      throw invalidMediaTransfer("Media transfer header names are invalid.");
    if (
      typeof value !== "string" ||
      value.length > 4096 ||
      /[\r\n]/.test(value)
    )
      throw invalidMediaTransfer("Media transfer header values are invalid.");
    normalized[name] = value;
  }
  return Object.freeze(normalized);
}
