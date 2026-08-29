import { RealtimeError } from "./core.js";

export function invokeRealtimeCallback(
  callback: () => void,
  name: string,
  onError?: (error: RealtimeError) => void,
): void {
  try {
    callback();
  } catch (error) {
    try {
      onError?.(
        new RealtimeError(
          "CALLBACK_ERROR",
          `Realtime ${name} callback failed`,
          { cause: error },
        ),
      );
    } catch {
      // Error observers must never take down the transport that reported it.
    }
  }
}

export function emitRealtimeError(
  callback: ((error: RealtimeError) => void) | undefined,
  error: RealtimeError,
): void {
  try {
    callback?.(error);
  } catch {
    // Error observers must never take down the transport that reported it.
  }
}
