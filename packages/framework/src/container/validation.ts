import { FrameworkError } from "../contracts/platform.js";
import type {
  BundleReference,
  ContainerMountRequest,
  ContainerPresentation,
} from "./contracts.js";

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function invalid(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new FrameworkError("FRAMEWORK_BUNDLE_REFERENCE", message, details);
}

function validatePresentation(
  presentation: ContainerPresentation | undefined,
): void {
  if (presentation === undefined) return;
  if (typeof presentation !== "object" || presentation === null)
    invalid("Container presentation must be an object.");
  if (
    presentation.title !== undefined &&
    (!presentation.title.trim() ||
      presentation.title.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(presentation.title))
  )
    invalid("Container presentation title is invalid.");
  for (const [name, value] of [
    ["hideNavigationBar", presentation.hideNavigationBar],
    ["hideStatusBar", presentation.hideStatusBar],
    ["transparentStatusBar", presentation.transparentStatusBar],
    [
      "showNavigationBarInTransparentStatusBar",
      presentation.showNavigationBarInTransparentStatusBar,
    ],
    ["hideLoading", presentation.hideLoading],
    ["hideError", presentation.hideError],
  ] as const)
    if (value !== undefined && typeof value !== "boolean")
      invalid(`Container presentation ${name} must be boolean.`);
  for (const [name, value] of [
    ["navigationBarColor", presentation.navigationBarColor],
    ["titleColor", presentation.titleColor],
    ["backgroundColor", presentation.backgroundColor],
    ["loadingBackgroundColor", presentation.loadingBackgroundColor],
  ] as const)
    if (value !== undefined && !/^#[0-9a-f]{6}$/i.test(value))
      invalid(`Container presentation ${name} must be a six-digit RGB color.`);
  if (
    presentation.theme !== undefined &&
    !["light", "dark", "system"].includes(presentation.theme)
  )
    invalid("Container presentation theme is invalid.");
  if (
    presentation.kind !== undefined &&
    !["page", "embedded"].includes(presentation.kind)
  )
    invalid("Container presentation kind is invalid.");
  if (
    presentation.contentMode !== undefined &&
    !["fixed-size", "fixed-width", "fixed-height", "fit-size"].includes(
      presentation.contentMode,
    )
  )
    invalid("Container presentation contentMode is invalid.");
}

/** Validate a full mount request before any host-side effect occurs. */
export function validateContainerMountRequest(
  request: ContainerMountRequest,
): void {
  validateBundleReference(request.bundle);
  validatePresentation(request.presentation);
}

/** Validate a bundle before a host adapter performs filesystem or network effects. */
export function validateBundleReference(bundle: BundleReference): void {
  if (!bundle.id.trim() || bundle.id.length > 256)
    invalid("Bundle ids must contain between 1 and 256 characters.");
  if (/[\u0000-\u001f\u007f]/.test(bundle.id))
    invalid("Bundle ids must not contain control characters.", {
      id: bundle.id,
    });

  const hasPath = bundle.path !== undefined;
  const hasUrl = bundle.url !== undefined;
  if (hasPath && hasUrl)
    invalid("A bundle must not provide both a local path and a URL.", {
      id: bundle.id,
    });
  // An id-only reference intentionally means an embedded or host-resolved
  // bundle. The container adapter remains responsible for resolving it.
  if (bundle.path !== undefined) {
    if (!bundle.path.trim() || bundle.path.includes("\0"))
      invalid(
        "Bundle paths must be non-empty and must not contain null bytes.",
        {
          id: bundle.id,
        },
      );
  }
  if (bundle.url !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(bundle.url);
    } catch {
      invalid("Bundle URLs must be valid absolute URLs.", { id: bundle.id });
    }
    const scheme = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    const isLocalHttp = scheme === "http:" && LOCAL_HTTP_HOSTS.has(host);
    if (scheme !== "https:" && !isLocalHttp)
      invalid("Bundle URLs must use HTTPS, except local development hosts.", {
        id: bundle.id,
      });
    if (parsed.username || parsed.password)
      invalid("Bundle URLs must not contain embedded credentials.", {
        id: bundle.id,
      });
  }
  if (bundle.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(bundle.sha256))
    invalid(
      "Bundle SHA-256 values must be exactly 64 hexadecimal characters.",
      {
        id: bundle.id,
      },
    );
}
