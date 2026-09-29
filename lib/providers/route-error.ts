/**
 * A failed call to one of this app's own routes, carrying the status alongside
 * the public message. Every provider client throws this so callers can tell a
 * transient outage — worth trying again on its own — from a settled refusal
 * that will fail identically forever.
 *
 * Status 0 means the request never reached the network.
 */
export class RouteError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

/** Duck-typed: a status survives even when the error crossed a mock or a wrapper. */
export function routeStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Statuses where the provider never reached a decision, so sending the same
 * request again is the same request rather than a second one. Everything else —
 * a bad key, no credits, a content-policy refusal, rejected controls — fails the
 * same way forever, and retrying it only hides the sentence that says why.
 * Lives here, not in auto-retry.ts, because that module is a React hook the
 * Worker cannot import, and the agent tools must answer "retryable?" the same way.
 */
const RETRYABLE_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}
