// lib/server/rate-limit.ts

/**
 * Fixed-window counters held in memory, so they hold per server instance: a
 * ceiling on how fast one instance spends an app-owned secret, not a shared
 * quota. Fluid Compute reuses instances, which keeps one caller's loop on few of them.
 */
export interface RateLimiter {
  consume(key: string, now?: number): { ok: true } | { ok: false; retryAfter: number };
  reset(): void;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, { start: number; count: number }>();
  return {
    consume(key, now = Date.now()) {
      for (const [name, bucket] of buckets) {
        if (now - bucket.start >= windowMs) buckets.delete(name);
      }
      const current = buckets.get(key);
      if (!current) {
        buckets.set(key, { start: now, count: 1 });
        return { ok: true };
      }
      if (current.count >= limit) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((current.start + windowMs - now) / 1000)) };
      }
      current.count += 1;
      return { ok: true };
    },
    reset() {
      buckets.clear();
    },
  };
}

/** The caller's address as the platform reports it. Vercel overwrites both headers at its edge. */
export function clientAddress(request: { headers?: { get(name: string): string | null } }): string {
  const headers = request.headers;
  if (!headers || typeof headers.get !== 'function') return 'unknown';
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || 'unknown';
}
