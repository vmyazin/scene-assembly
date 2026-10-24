// lib/describe-source/limit.ts
import { clientAddress, createRateLimiter } from '@/lib/server/rate-limit';

const WINDOW_MS = 10 * 60 * 1000;

/**
 * A describe call can carry megabytes of vision input billed to `HF_TOKEN`.
 * Twelve an address per ten minutes leaves room to retry while editing, and
 * stops a loop from spending the shared tier. The window is in memory, so it
 * holds per server instance — the same shape as a process that has no shared
 * counter.
 */
export const DESCRIBE_RATE_LIMIT = 12;

const limiter = createRateLimiter(DESCRIBE_RATE_LIMIT, WINDOW_MS);

export function resetDescribeRateLimit(): void {
  limiter.reset();
}

export const describeClientKey = clientAddress;

export function consumeDescribeRateLimit(
  key: string,
  now = Date.now()
): { ok: true } | { ok: false; retryAfter: number } {
  return limiter.consume(key, now);
}
