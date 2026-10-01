'use client';

import RetryCountdown from '@/components/RetryCountdown';
import type { PendingRetry } from '@/lib/providers/auto-retry';

interface SubmissionErrorProps {
  message: string;
  /** Present only while an automatic attempt is counting down. */
  retry?: PendingRetry | null;
  onCancelRetry?: () => void;
  /** Policy block on a route that can still switch to Relaxed. */
  offerTryRelaxed?: boolean;
  onTryRelaxed?: () => void;
}

/**
 * The failure line under a Generate button, plus the countdown to the attempt
 * the workspace is about to make on its own. `role="alert"` stays on the message
 * alone — a live region wrapped around a per-second countdown would re-announce
 * the whole failure every tick.
 */
export default function SubmissionError({ message, retry, onCancelRetry, offerTryRelaxed, onTryRelaxed }: SubmissionErrorProps) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
      <p role="alert">{message}</p>
      {offerTryRelaxed && onTryRelaxed && (
        <button type="button" className="btn-secondary mt-2 text-xs" onClick={onTryRelaxed}>
          Try with Relaxed
        </button>
      )}
      <RetryCountdown retry={retry} onCancel={onCancelRetry} />
    </div>
  );
}
