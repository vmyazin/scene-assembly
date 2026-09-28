'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { isRetryableStatus, routeStatus } from './route-error';

/** How long a failed submission waits before it is sent again on its own. */
export const AUTO_RETRY_DELAY_SECONDS = 10;
/** Automatic attempts made after the one the user asked for. */
export const AUTO_RETRY_LIMIT = 5;

export function isRetryableFailure(error: unknown): boolean {
  const status = routeStatus(error);
  if (status !== undefined) return isRetryableStatus(status);
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
