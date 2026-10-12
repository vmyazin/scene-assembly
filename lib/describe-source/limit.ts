// lib/describe-source/limit.ts

const WINDOW_MS = 10 * 60 * 1000;

/**
 * A describe call can carry megabytes of vision input billed to `HF_TOKEN`.
 * Twelve an address per ten minutes leaves room to retry while editing, and
 * stops a loop from spending the shared tier. The window is in memory, so it
 * holds per server instance — the same shape as a process that has no shared
 * counter.
 */
export const DESCRIBE_RATE_LIMIT = 12;

interface Bucket {
  start: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export function resetDescribeRateLimit(): void {
  buckets.clear();
}

export function describeClientKey(request: { headers?: { get(name: string): string | null } }): string {
  const headers = request.headers;
  if (!headers || typeof headers.get !== 'function') return 'unknown';
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

export function consumeDescribeRateLimit(
  key: string,
  now = Date.now()
): { ok: true } | { ok: false; retryAfter: number } {
  for (const [name, bucket] of buckets) {
    if (now - bucket.start >= WINDOW_MS) buckets.delete(name);
  }

  const current = buckets.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return { ok: true };
  }
  if (current.count >= DESCRIBE_RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((current.start + WINDOW_MS - now) / 1000));
    return { ok: false, retryAfter };
  }
  current.count += 1;
  return { ok: true };
}
