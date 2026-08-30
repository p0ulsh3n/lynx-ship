import {
  BRIDGE_SUCCESS_CODE,
  type BridgeTransport,
  type BridgeValue,
} from "./contracts.js";
import { BridgeError } from "./errors.js";

export interface LynxBridgeModule {
  invoke(requestJson: string, callback: (result: unknown) => void): void;
  subscribe?(event: string, callback: (result: unknown) => void): void;
  unsubscribe?(event: string): void;
}

export function getLynxBridgeModule(): LynxBridgeModule {
  const nativeModules = (
    globalThis as typeof globalThis & {
      NativeModules?: Record<string, unknown>;
    }
  ).NativeModules;
  const module = nativeModules?.LynxShipBridge;
  if (!module || typeof module !== "object")
    throw new Error("LynxShipBridge native module is not linked.");
  const candidate = module as Partial<LynxBridgeModule>;
  if (typeof candidate.invoke !== "function")
    throw new Error("LynxShipBridge native module is incomplete.");
  return candidate as LynxBridgeModule;
}

export function createLynxBridgeTransport(
  module: LynxBridgeModule = getLynxBridgeModule(),
): BridgeTransport {
  return {
    invoke(method, args, signal, context) {
      const requestJson = JSON.stringify({
        method,
        args,
        ...(context ?? {}),
      });
      return new Promise<BridgeValue>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          callback();
        };
        const onAbort = (): void =>
          finish(() => reject(new Error("Native bridge request aborted.")));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          module.invoke(requestJson, (result) => {
            finish(() => {
              try {
                resolve(decodeNativeResult(result));
              } catch (error) {
                reject(error);
              }
            });
          });
        } catch (error) {
          finish(() => reject(error));
        }
      });
    },
    subscribe: module.subscribe
      ? (event, listener) => {
          module.subscribe?.(event, (result) => {
            try {
              listener(decodeNativeResult(result));
            } catch {
              // Malformed native events must never escape into the app runtime.
            }
          });
          return () => module.unsubscribe?.(event);
        }
      : undefined,
  };
}

function decodeNativeResult(result: unknown): BridgeValue {
  let decoded: unknown;
  try {
    decoded = typeof result === "string" ? JSON.parse(result) : result;
  } catch (error) {
    throw new BridgeError(
      "BRIDGE_INVALID_RESPONSE",
      "The native bridge returned invalid JSON.",
      { cause: error instanceof Error ? error.message : "unknown" },
    );
  }
  if (!decoded || typeof decoded !== "object") return decoded as BridgeValue;
  const envelope = decoded as Record<string, unknown>;
  if (typeof envelope.code === "number" && typeof envelope.msg === "string") {
    if (envelope.code === BRIDGE_SUCCESS_CODE)
      return ("data" in envelope ? envelope.data : null) as BridgeValue;
    throw new BridgeError("BRIDGE_NATIVE_ERROR", envelope.msg, {
      providerCode: envelope.code,
    });
  }
  if (!("success" in envelope)) return decoded as BridgeValue;
  if (envelope.success !== true)
    throw new BridgeError(
      "BRIDGE_NATIVE_ERROR",
      typeof envelope.message === "string"
        ? envelope.message
        : "The native bridge rejected the request.",
    );
  if (!("value" in envelope))
    throw new Error("The native bridge returned no value.");
  return envelope.value as BridgeValue;
}
