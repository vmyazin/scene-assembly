'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { classifyFailure } from '@/lib/moderation/classify';
import { routeStatus } from './route-error';

/** How long a failed submission waits before it is sent again on its own. */
export const AUTO_RETRY_DELAY_SECONDS = 10;
/** Automatic attempts made after the one the user asked for. */
export const AUTO_RETRY_LIMIT = 5;

/**
 * Statuses where the provider never reached a decision, so sending the same
 * request again is the same request rather than a second one. Everything else —
 * a bad key, no credits, a content-policy refusal, rejected controls — fails the
 * same way forever, and retrying it only hides the sentence that says why.
 */
const RETRYABLE_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

export function isRetryableFailure(error: unknown): boolean {
  // A content filter has already decided. Sending it again spends another
  // attempt on the same refusal, so policy and floor messages are never
  // retried even when a provider wraps them in a 500.
  const message = error instanceof Error ? error.message : '';
  const kind = classifyFailure(message).kind;
  if (kind === 'policy' || kind === 'floor') return false;
  const status = routeStatus(error);
  if (status !== undefined) return RETRYABLE_STATUSES.has(status);
  // fetch() rejects with a TypeError when the request never left the machine.
  return error instanceof TypeError;
}

export interface PendingRetry {
  /** 1-based, counted against AUTO_RETRY_LIMIT. */
  attempt: number;
  secondsRemaining: number;
}

export interface AutoRetry {
  /** Non-null only while an attempt is counting down. */
  pending: PendingRetry | null;
  /** Queues one more run of `action`; false once the budget is spent. */
  schedule: (action: () => void) => boolean;
  /** Drops the queued attempt but keeps the budget spent. */
  cancel: () => void;
  /** Drops the queued attempt and hands back the full budget. */
  reset: () => void;
}

/**
 * A countdown to one more try. The caller hands `schedule` the same call it
 * would make itself — a workspace passes its own `submit`, so a retry re-runs
 * validation and uploads rather than a second copy of them.
 */
export function useAutoRetry(): AutoRetry {
  const actionRef = useRef<() => void>(() => {});
  const attemptsRef = useRef(0);
  const [pending, setPending] = useState<PendingRetry | null>(null);

  // Keyed on which attempt is queued, so a per-second display update never
  // restarts the clock — but a new attempt always gets its own timers, even when
  // it is queued before React has committed the end of the previous one. The
  // cleanup covers cancelling and unmounting alike, so a workspace left behind
  // mid-countdown never resubmits.
  const activeAttempt = pending?.attempt ?? 0;
  useEffect(() => {
    if (activeAttempt === 0) return;
    const ticker = setInterval(() => {
      setPending((current) =>
        current
          ? { ...current, secondsRemaining: Math.max(0, current.secondsRemaining - 1) }
          : current
      );
    }, 1_000);
    const fire = setTimeout(() => {
      setPending(null);
      actionRef.current();
    }, AUTO_RETRY_DELAY_SECONDS * 1_000);

    return () => {
      clearInterval(ticker);
      clearTimeout(fire);
    };
  }, [activeAttempt]);

  const cancel = useCallback(() => setPending(null), []);

  const reset = useCallback(() => {
    attemptsRef.current = 0;
    setPending(null);
  }, []);

  const schedule = useCallback((action: () => void) => {
    if (attemptsRef.current >= AUTO_RETRY_LIMIT) return false;
    attemptsRef.current += 1;
    actionRef.current = action;
    setPending({ attempt: attemptsRef.current, secondsRemaining: AUTO_RETRY_DELAY_SECONDS });
    return true;
  }, []);

  return { pending, schedule, cancel, reset };
}
