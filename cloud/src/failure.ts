import { AccountError } from './jobs';
import { isRecoverable, MAX_RESUME_ATTEMPTS, type FailureReason } from '../../lib/account/job-failure';

/**
 * Worker-side classification of a failure into the shared vocabulary.
 *
 * The vocabulary itself, and which of its members a resume could plausibly fix,
 * live in `lib/account/job-failure.ts` — one list, because this module enforces
 * what that copy promises. A reason that is recoverable here and not there is a
 * Resume button the Worker answers 409 to.
 */
export { isRecoverable, MAX_RESUME_ATTEMPTS };
export type { FailureReason };

/**
 * The only door vendor text uses to reach D1.
 *
 * A provider's failure message is the most useful thing on a stopped row —
 * "prompt violates content policy" is worth more than every state label
 * combined — and it is also the one string here we did not write. It can echo a
 * request back, and a request carries a key. So: URLs go, anything long enough
 * and alphabet-y enough to be a credential goes, and the remainder is capped at
 * a sentence or two.
 */
export function sanitizeProviderMessage(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const scrubbed = text
    .replace(/\s+/g, ' ')
    .replace(/\b(?:https?|wss?|ftp|data):\S*/gi, '')
    .replace(/\b(?:Bearer|Basic|api[_-]?key|token|secret|authorization)\b\s*[:=]?\s*\S*/gi, '')
    .replace(/\b(?:sk|pk|rw|xai|ghp|gsk)[-_][A-Za-z0-9_-]{8,}/g, '')
    .replace(/[A-Za-z0-9_-]{24,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (scrubbed.length < 3) return null;
  return scrubbed.length > 200 ? `${scrubbed.slice(0, 199).trimEnd()}…` : scrubbed;
}

/**
 * Classifies a capture failure.
 *
 * `captureResult` already distinguished these; the runner flattened them into
 * one `Error` on the way out. Both sides of that boundary run inside the same
 * `step.do` callback, so the `AccountError` prototype is still intact here —
 * which is exactly why classification happens at the throw site and not after
 * the Workflow has persisted the error.
 */
export function captureFailureReason(error: unknown): FailureReason {
  if (error instanceof AccountError) {
    const mapped: Record<string, FailureReason> = {
      storage_full: 'storage_full',
      result_size: 'result_too_large',
      result_count: 'result_count',
      result_type: 'result_wrong_type',
      result_location: 'result_location',
      result_link_expired: 'result_link_expired',
      result_missing: 'result_missing',
      result_empty: 'result_empty',
      staged_missing: 'staged_missing',
      save_failed: 'transfer_failed',
    };
    return mapped[error.code] ?? 'transfer_failed';
  }
  return 'transfer_failed';
}

/**
 * Classifies a submission or polling failure.
 *
 * A 4xx is the provider having read the request and refused it, which is worth
 * repeating to the reader; anything else is treated as not having reached it,
 * which is the safer reading when the alternative is telling someone their
 * prompt was rejected by a provider that never saw it.
 */
export function providerFailureReason(error: unknown): { reason: FailureReason; detail: string | null } {
  if (error instanceof AccountError) return { reason: 'provider_rejected', detail: sanitizeProviderMessage(error.message) };
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { reason: 'provider_rejected', detail: sanitizeProviderMessage((error as Error)?.message) };
  }
  return { reason: 'provider_unreachable', detail: null };
}
