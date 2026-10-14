// components/KieJobsProvider.tsx
'use client';

import { useEffect, useRef } from 'react';
import { trackQueuedTerminal } from '@/lib/analytics/generation-result';
import { getKieJobStatus } from '@/lib/kie/browser';
import { KIE_MODELS } from '@/lib/kie/catalog';
import { isKieJobTerminal, KIE_JOB_TIMEOUT_MS, nextKiePollDelay } from '@/lib/kie/queue';
import type { KieJob } from '@/lib/kie/types';
import { useAppStore } from '@/store/useAppStore';
import { useKieJobsStore } from '@/store/useKieJobsStore';
import { recordFinishedJob } from '@/lib/gallery/record-job';
import { playGenerationChime } from '@/lib/notify/chime';
import { captureKieJob } from '@/lib/spend/capture';

const KIE_TIMEOUT_MESSAGE = 'Kie generation timed out after 15 minutes. The task was not resubmitted.';

function reportKieTerminal(job: KieJob, succeeded: boolean, error?: string): void {
  trackQueuedTerminal({
    engine: 'kie',
    route: job.modelId,
    model: KIE_MODELS.find((model) => model.id === job.modelId)?.label ?? job.modelId,
    media: job.mediaType,
    controlValues: job.controlValues,
    succeeded,
    error,
  });
}

interface PollOperation {
  apiKey: string;
  timer?: number;
  controller?: AbortController;
}

function stopOperation(operation: PollOperation): void {
  if (operation.timer !== undefined) window.clearTimeout(operation.timer);
  operation.controller?.abort();
}

function currentJob(id: string): KieJob | undefined {
  return useKieJobsStore.getState().jobs.find((job) => job.id === id);
}

export default function KieJobsProvider({ children }: { children: React.ReactNode }) {
  const apiKey = useAppStore((state) => state.kieApiKey);
  const jobs = useKieJobsStore((state) => state.jobs);
  const upsertJob = useKieJobsStore((state) => state.upsertJob);
  // One poll per job, kept across renders. Rescheduling on every change to the
  // job list left an earlier status call running beside the new one, and each
  // wrote back the job as it first saw it: a slug saved in between was lost, and
  // a success could be recorded, billed and chimed twice.
  const operationsRef = useRef(new Map<string, PollOperation>());

  useEffect(() => {
    const operations = operationsRef.current;
    return () => {
      for (const operation of operations.values()) stopOperation(operation);
      operations.clear();
    };
  }, []);

  useEffect(() => {
    const operations = operationsRef.current;
    const listedJobs = new Map(jobs.map((job) => [job.id, job]));

    for (const [id, operation] of operations) {
      const job = listedJobs.get(id);
      if (!job || isKieJobTerminal(job.state) || operation.apiKey !== apiKey) {
        stopOperation(operation);
        operations.delete(id);
      }
    }

    if (!apiKey) return;

    // A response is applied only by the poll that is still registered for its
    // job, and onto the job as it is now — never the copy the poll started from.
    const settle = (id: string, operation: PollOperation): KieJob | undefined => {
      if (operations.get(id) !== operation) return undefined;
      operations.delete(id);
      const latest = currentJob(id);
      return latest && !isKieJobTerminal(latest.state) ? latest : undefined;
    };

    for (const job of jobs) {
      if (isKieJobTerminal(job.state) || operations.has(job.id)) continue;

      const elapsed = Date.now() - job.createdAt;
      if (elapsed >= KIE_JOB_TIMEOUT_MS) {
        reportKieTerminal(job, false, KIE_TIMEOUT_MESSAGE);
        upsertJob({
          ...job,
          state: 'fail',
          error: KIE_TIMEOUT_MESSAGE,
          updatedAt: Date.now(),
        });
        continue;
      }

      const operation: PollOperation = { apiKey };
      operations.set(job.id, operation);
      operation.timer = window.setTimeout(() => {
        operation.timer = undefined;
        const controller = new AbortController();
        operation.controller = controller;
        void getKieJobStatus(
          { apiKey, taskId: job.taskId, protocol: job.protocol },
          { signal: controller.signal }
        )
          .then((task) => {
            const latest = settle(job.id, operation);
            if (!latest) return;
            // Poll stops at a terminal state, so this transition happens once.
            // A still-running poll is not a result.
            if (task.state === 'success') {
              reportKieTerminal(latest, true);
              recordFinishedJob('kie', latest, task.resultUrls[0]);
              captureKieJob(latest, apiKey, useKieJobsStore.getState().jobs);
              playGenerationChime();
            } else if (task.state === 'fail') {
              reportKieTerminal(latest, false, task.error);
            }
            upsertJob({
              ...latest,
              ...task,
              updatedAt: Date.now(),
              pollAttempt: latest.pollAttempt + 1,
            });
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            const latest = settle(job.id, operation);
            if (!latest) return;
            const message = error instanceof Error
              ? error.message
              : 'Kie status check failed. The task was not resubmitted.';
            reportKieTerminal(latest, false, message);
            upsertJob({
              ...latest,
              state: 'fail',
              error: message,
              updatedAt: Date.now(),
            });
          });
      }, Math.min(nextKiePollDelay(job.pollAttempt), KIE_JOB_TIMEOUT_MS - elapsed));
    }
  }, [apiKey, jobs, upsertJob]);

  return children;
}
