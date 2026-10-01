// components/KieJobsProvider.tsx
'use client';

import { useEffect } from 'react';
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

export default function KieJobsProvider({ children }: { children: React.ReactNode }) {
  const apiKey = useAppStore((state) => state.kieApiKey);
  const jobs = useKieJobsStore((state) => state.jobs);
  const upsertJob = useKieJobsStore((state) => state.upsertJob);

  useEffect(() => {
    if (!apiKey) return;

    const timers = jobs
      .filter((job) => !isKieJobTerminal(job.state))
      .map((job) => {
        const elapsed = Date.now() - job.createdAt;
        if (elapsed >= KIE_JOB_TIMEOUT_MS) {
          reportKieTerminal(job, false, KIE_TIMEOUT_MESSAGE);
          upsertJob({
            ...job,
            state: 'fail',
            error: KIE_TIMEOUT_MESSAGE,
            updatedAt: Date.now(),
          });
          return undefined;
        }

        return window.setTimeout(() => {
          void getKieJobStatus({ apiKey, taskId: job.taskId, protocol: job.protocol })
            .then((task) => {
              // Poll stops at a terminal state, so this transition happens once.
              // A still-running poll is not a result.
              if (task.state === 'success') {
                reportKieTerminal(job, true);
                recordFinishedJob('kie', job, task.resultUrls[0]);
                captureKieJob(job, apiKey, useKieJobsStore.getState().jobs);
                playGenerationChime();
              } else if (task.state === 'fail') {
                reportKieTerminal(job, false, task.error);
              }
              upsertJob({
                ...job,
                ...task,
                updatedAt: Date.now(),
                pollAttempt: job.pollAttempt + 1,
              });
            })
            .catch((error: unknown) => {
              const message = error instanceof Error
                ? error.message
                : 'Kie status check failed. The task was not resubmitted.';
              reportKieTerminal(job, false, message);
              upsertJob({
                ...job,
                state: 'fail',
                error: message,
                updatedAt: Date.now(),
              });
            });
        }, Math.min(nextKiePollDelay(job.pollAttempt), KIE_JOB_TIMEOUT_MS - elapsed));
      })
      .filter((timer): timer is number => timer !== undefined);

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [apiKey, jobs, upsertJob]);

  return children;
}
