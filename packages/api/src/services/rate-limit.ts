export class FixedWindowRateLimiter {
  readonly buckets = new Map<string, { count: number; expiresAt: number }>();

  constructor(readonly options: { limit?: number; windowMs?: number } = {}) {}

  check(
    key: string,
    now = Date.now(),
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const limit = this.options.limit ?? 60;
    const windowMs = this.options.windowMs ?? 60_000;
    const current = this.buckets.get(key);

    if (!current || current.expiresAt <= now) {
      const next = { count: 1, expiresAt: now + windowMs };
      this.buckets.set(key, next);
      return { allowed: true, remaining: limit - 1, resetAt: next.expiresAt };
    }

    current.count += 1;
    return {
      allowed: current.count <= limit,
      remaining: Math.max(0, limit - current.count),
      resetAt: current.expiresAt,
    };
  }
}
