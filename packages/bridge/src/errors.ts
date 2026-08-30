export class BridgeError extends Error {
  public readonly code:
    | "BRIDGE_INVALID_CONTRACT"
    | "BRIDGE_METHOD_DENIED"
    | "BRIDGE_CAPABILITY_DENIED"
    | "BRIDGE_PERMISSION_DENIED"
    | "BRIDGE_EVENT_DENIED"
    | "BRIDGE_INVALID_RESPONSE"
    | "BRIDGE_NATIVE_ERROR"
    | "BRIDGE_PAYLOAD_TOO_LARGE"
    | "BRIDGE_TIMEOUT"
    | "BRIDGE_DISPOSED";

  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: BridgeError["code"],
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.details = details;
  }
}
