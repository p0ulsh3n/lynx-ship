import {
  DEFAULT_RECONNECT_BASE_DELAY_MS,
  DEFAULT_RECONNECT_JITTER,
  DEFAULT_RECONNECT_MAX_DELAY_MS,
  type RealtimeReconnectOptions,
} from "./core.js";

const NON_RECONNECTABLE_CODES = new Set([
  1000, 1002, 1003, 1007, 1008, 1009, 4003,
]);

export function shouldReconnect(
  code: number,
  options: RealtimeReconnectOptions | undefined,
  attempt: number,
): boolean {
  return (
    !NON_RECONNECTABLE_CODES.has(code) &&
    options?.enabled !== false &&
    attempt < (options?.maxAttempts ?? 8)
  );
}

export function reconnectDelay(
  options: RealtimeReconnectOptions | undefined,
  attempt: number,
  random: () => number,
): number {
  const base = Math.max(
    1,
    options?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
  );
  const maximum = Math.max(
    base,
    options?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
  );
  const jitter = Math.max(
    0,
    Math.min(1, options?.jitterRatio ?? DEFAULT_RECONNECT_JITTER),
  );
  const delay = Math.min(maximum, base * 2 ** attempt);
  const factor = 1 - jitter + random() * jitter * 2;
  return Math.max(1, Math.floor(delay * factor));
}
