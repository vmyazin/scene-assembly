// components/FalJobsProvider.tsx
'use client';

import { useEffect, useRef } from 'react';

import { trackQueuedTerminal } from '@/lib/analytics/generation-result';
import { getFalJobStatus } from '@/lib/fal/browser';
import { falModelLabel } from '@/lib/fal/catalog';
import { FAL_JOB_TIMEOUT_MS, isFalJobTerminal, nextFalPollDelay } from '@/lib/fal/queue';
import type { FalJob, FalTask } from '@/lib/fal/types';
import { useAppStore } from '@/store/useAppStore';
import { useFalJobsStore } from '@/store/useFalJobsStore';
import { recordFinishedJob } from '@/lib/gallery/record-job';
import { playGenerationChime } from '@/lib/notify/chime';
import { captureFalJob } from '@/lib/spend/capture';

const FAL_TIMEOUT_MESSAGE =
  'Polling stopped after 15 minutes. The fal job may still complete upstream.';

interface JobOperation {
  apiKey: string;
  controller?: AbortController;
  signature: string;
  timer?: number;
  token: symbol;
}

function jobSignature(job: FalJob): string {
  return [job.requestId, job.modelId, job.mediaType, job.inputMode].join('\u0000');
}

function currentJob(id: string): FalJob | undefined {
  return useFalJobsStore.getState().jobs.find((job) => job.id === id);
}

function timedOutJob(job: FalJob, updatedAt: number): FalJob {
  return {
    ...job,
    state: 'timed_out',
    error: FAL_TIMEOUT_MESSAGE,
    updatedAt,
  };
}

function reportFalTerminal(job: FalJob, succeeded: boolean, error?: string): void {
  trackQueuedTerminal({
    engine: 'fal',
    route: job.modelId,
    model: falModelLabel(job.modelId),
    media: job.mediaType,
    controlValues: job.controlValues,
    succeeded,
    error,
  });
}

function taskSnapshot(job: FalJob, task: FalTask, updatedAt: number): FalJob {
  return {
    ...job,
    requestId: task.requestId,
    state: task.state,
    logs: task.logs,
    resultUrl: task.resultUrl,
    mimeType: task.mimeType,
    error: task.error,
    updatedAt,
    pollAttempt: job.pollAttempt + 1,
  };
}

export default function FalJobsProvider({ children }: { children: React.ReactNode }) {
  const apiKey = useAppStore((state) => state.falApiKey);
  const jobs = useFalJobsStore((state) => state.jobs);
  const upsertJob = useFalJobsStore((state) => state.upsertJob);
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

  useEffect(() => {
    const operations = operationsRef.current;
    const normalizedApiKey = apiKey.trim();
    const listedJobs = new Map(jobs.map((job) => [job.id, job]));

    const invalidate = (id: string, operation: JobOperation) => {
      if (operation.timer !== undefined) window.clearTimeout(operation.timer);
      operation.controller?.abort();
      if (operations.get(id) === operation) operations.delete(id);
    };

    for (const [id, operation] of operations) {
      const job = listedJobs.get(id);
      if (
        !job ||
        isFalJobTerminal(job.state) ||
        jobSignature(job) !== operation.signature ||
        normalizedApiKey !== operation.apiKey
      ) {
        invalidate(id, operation);
      }
    }

    const operationIsCurrent = (job: FalJob, operation: JobOperation) =>
      mountedRef.current &&
      operations.get(job.id) === operation &&
      operation.token === operations.get(job.id)?.token &&
      operation.signature === jobSignature(job) &&
      operation.apiKey === useAppStore.getState().falApiKey.trim() &&
      !isFalJobTerminal(job.state);

    const finishWithTimeout = (job: FalJob, operation: JobOperation, now: number) => {
      if (!operationIsCurrent(job, operation)) return;
      if (operation.timer !== undefined) window.clearTimeout(operation.timer);
      operation.timer = undefined;
      operations.delete(job.id);
      operation.controller?.abort();
      reportFalTerminal(job, false, FAL_TIMEOUT_MESSAGE);
      upsertJob(timedOutJob(job, now));
    };

    const settle = (id: string, operation: JobOperation, task?: FalTask) => {
      const job = currentJob(id);
      if (!job || !operationIsCurrent(job, operation)) return;

      const now = Date.now();
      if (now - job.createdAt >= FAL_JOB_TIMEOUT_MS) {
        finishWithTimeout(job, operation, now);
        return;
      }

      if (operation.timer !== undefined) window.clearTimeout(operation.timer);
      operation.timer = undefined;
      operations.delete(id);
      operation.controller = undefined;
      if (task) {
        // Poll stops at a terminal state, so this transition happens once.
        // Running and queued updates are not a result: a later refusal would
        // otherwise already have been counted as a success.
        if (task.state === 'success') {
          reportFalTerminal(job, true);
          recordFinishedJob('fal', { ...job, mimeType: task.mimeType }, task.resultUrl);
          captureFalJob(job, operation.apiKey);
          playGenerationChime();
        } else if (task.state === 'fail' || task.state === 'timed_out') {
          reportFalTerminal(job, false, task.error);
        }
        upsertJob(taskSnapshot(job, task, now));
        return;
      }

      upsertJob({
        ...job,
        error: undefined,
        updatedAt: now,
        pollAttempt: job.pollAttempt + 1,
      });
    };

    for (const job of jobs) {
      if (isFalJobTerminal(job.state) || operations.has(job.id)) continue;

      const now = Date.now();
      const remaining = FAL_JOB_TIMEOUT_MS - (now - job.createdAt);
      if (remaining <= 0) {
        reportFalTerminal(job, false, FAL_TIMEOUT_MESSAGE);
        upsertJob(timedOutJob(job, now));
        continue;
      }

      const operation: JobOperation = {
        apiKey: normalizedApiKey,
        signature: jobSignature(job),
        token: Symbol(job.id),
      };
      const delay = normalizedApiKey
        ? Math.min(nextFalPollDelay(job.pollAttempt), remaining)
        : remaining;

      operation.timer = window.setTimeout(() => {
        operation.timer = undefined;
        const latest = currentJob(job.id);
        if (!latest || !operationIsCurrent(latest, operation)) return;

        if (Date.now() - latest.createdAt >= FAL_JOB_TIMEOUT_MS) {
          finishWithTimeout(latest, operation, Date.now());
          return;
        }

        if (!operation.apiKey) return;

        const controller = new AbortController();
        operation.controller = controller;
        operation.timer = window.setTimeout(() => {
          operation.timer = undefined;
          const inFlightJob = currentJob(latest.id);
          if (inFlightJob) finishWithTimeout(inFlightJob, operation, Date.now());
        }, FAL_JOB_TIMEOUT_MS - (Date.now() - latest.createdAt));
        void getFalJobStatus(
          {
            apiKey: operation.apiKey,
            modelId: latest.modelId,
            mediaType: latest.mediaType,
            inputMode: latest.inputMode,
            requestId: latest.requestId,
          },
          { signal: controller.signal }
        ).then(
          (task) => settle(latest.id, operation, task),
          () => {
            if (!controller.signal.aborted) settle(latest.id, operation);
          }
        );
      }, delay);
      operations.set(job.id, operation);
    }
  }, [apiKey, jobs, upsertJob]);

  return children;
}
