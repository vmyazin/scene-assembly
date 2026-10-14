// lib/jobs/use-queued-job-polling.ts
'use client';

import { useEffect, useRef } from 'react';

/** What the engine needs from a provider's job record. */
export interface QueuedJob {
  id: string;
  createdAt: number;
  pollAttempt: number;
}

export interface QueuedJobPolling<J extends QueuedJob, T> {
  jobs: J[];
  /** The key on screen now, trimmed. */
  apiKey: string;
  /** The key as the store holds it at the moment a response lands. */
  readApiKey: () => string;
  /** The job as the store holds it now — never the copy a poll started from. */
  readJob: (id: string) => J | undefined;
  upsertJob: (job: J) => void;
  isTerminal: (job: J) => boolean;
  /** What makes two records the same remote task; a change restarts polling. */
  signature: (job: J) => string;
  timeoutMs: number;
  nextDelay: (attempt: number) => number;
  /** Keep the local deadline while the key is missing (fal), or pause entirely (Kie). */
  timeoutWithoutKey: boolean;
  fetchStatus: (job: J, apiKey: string, signal: AbortSignal) => Promise<T>;
  /** The job after a status response, plus any reporting for a terminal one. */
  onTask: (job: J, task: T, apiKey: string, now: number) => J;
  /** The job when a status call fails: a retry snapshot, or a failure. */
  onPollError: (job: J, error: unknown, now: number) => J;
  /** The job when the local deadline passes. */
  onTimeout: (job: J, now: number) => J;
}

interface JobOperation {
  apiKey: string;
  controller?: AbortController;
  signature: string;
  timer?: number;
}

/**
 * Polls each unfinished job with backoff until it reaches a terminal state or
 * its local deadline, with at most one status call per job at a time.
 *
 * An operation survives re-renders: rescheduling on every change to the job
 * list left an earlier status call running beside the new one, and each wrote
 * back the job as it first saw it, so a field saved in between was lost and a
 * success could be recorded twice. A response is applied only by the operation
 * still registered for its job, and onto the job as the store holds it now.
 */
export function useQueuedJobPolling<J extends QueuedJob, T>(options: QueuedJobPolling<J, T>): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const operationsRef = useRef(new Map<string, JobOperation>());
  const mountedRef = useRef(false);

  useEffect(() => {
    const operations = operationsRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const operation of operations.values()) {
        if (operation.timer !== undefined) window.clearTimeout(operation.timer);
        operation.controller?.abort();
      }
      operations.clear();
    };
  }, []);

  const { jobs, apiKey } = options;

  useEffect(() => {
    const operations = operationsRef.current;
    const {
      readApiKey, readJob, upsertJob, isTerminal, signature, timeoutMs, nextDelay,
      timeoutWithoutKey,
    } = optionsRef.current;
    const listedJobs = new Map(jobs.map((job) => [job.id, job]));

    const invalidate = (id: string, operation: JobOperation) => {
      if (operation.timer !== undefined) window.clearTimeout(operation.timer);
      operation.controller?.abort();
      if (operations.get(id) === operation) operations.delete(id);
    };

    for (const [id, operation] of operations) {
      const job = listedJobs.get(id);
      if (!job || isTerminal(job) || signature(job) !== operation.signature || apiKey !== operation.apiKey) {
        invalidate(id, operation);
      }
    }

    const isCurrent = (job: J, operation: JobOperation) =>
      mountedRef.current &&
      operations.get(job.id) === operation &&
      operation.signature === signature(job) &&
      operation.apiKey === readApiKey() &&
      !isTerminal(job);

    const finishWithTimeout = (job: J, operation: JobOperation, now: number) => {
      if (!isCurrent(job, operation)) return;
      invalidate(job.id, operation);
      upsertJob(optionsRef.current.onTimeout(job, now));
    };

    const settle = (id: string, operation: JobOperation, outcome: { task: T } | { error: unknown }) => {
      const job = readJob(id);
      if (!job || !isCurrent(job, operation)) return;
      const now = Date.now();
      if (now - job.createdAt >= timeoutMs) {
        finishWithTimeout(job, operation, now);
        return;
      }
      if (operation.timer !== undefined) window.clearTimeout(operation.timer);
      operation.timer = undefined;
      operation.controller = undefined;
      operations.delete(id);
      upsertJob(
        'task' in outcome
          ? optionsRef.current.onTask(job, outcome.task, operation.apiKey, now)
          : optionsRef.current.onPollError(job, outcome.error, now)
      );
    };

    for (const job of jobs) {
      if (isTerminal(job) || operations.has(job.id)) continue;
      if (!apiKey && !timeoutWithoutKey) continue;

      const now = Date.now();
      const remaining = timeoutMs - (now - job.createdAt);
      if (remaining <= 0) {
        upsertJob(optionsRef.current.onTimeout(job, now));
        continue;
      }

      const operation: JobOperation = { apiKey, signature: signature(job) };
      operations.set(job.id, operation);
      operation.timer = window.setTimeout(() => {
        operation.timer = undefined;
        const latest = readJob(job.id);
        if (!latest || !isCurrent(latest, operation)) return;
        if (Date.now() - latest.createdAt >= timeoutMs) {
          finishWithTimeout(latest, operation, Date.now());
          return;
        }
        // Without a key this timer only ever stood for the deadline.
        if (!operation.apiKey) return;

        const controller = new AbortController();
        operation.controller = controller;
        // The deadline still holds while a status call is in flight.
        operation.timer = window.setTimeout(() => {
          operation.timer = undefined;
          const inFlight = readJob(latest.id);
          if (inFlight) finishWithTimeout(inFlight, operation, Date.now());
        }, timeoutMs - (Date.now() - latest.createdAt));
        void optionsRef.current.fetchStatus(latest, operation.apiKey, controller.signal).then(
          (task) => settle(latest.id, operation, { task }),
          (error: unknown) => {
            if (!controller.signal.aborted) settle(latest.id, operation, { error });
          }
        );
      }, apiKey ? Math.min(nextDelay(job.pollAttempt), remaining) : remaining);
    }
  }, [jobs, apiKey]);
}
