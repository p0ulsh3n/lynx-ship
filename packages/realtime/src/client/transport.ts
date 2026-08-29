import {
  RealtimeError,
  type RealtimeSocket,
  type RealtimeState,
} from "./core.js";

export function sendRealtimeSerialized(
  socket: RealtimeSocket | null,
  state: RealtimeState,
  serialized: string,
): void {
  if (!socket || state !== "open")
    throw new RealtimeError("SOCKET_ERROR", "Realtime socket is not open");
  try {
    socket.send(serialized);
  } catch (error) {
    throw new RealtimeError(
      "SOCKET_ERROR",
      "Realtime message could not be sent",
      { cause: error },
    );
  }
}
