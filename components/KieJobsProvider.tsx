// components/KieJobsProvider.tsx
'use client';

import { trackQueuedTerminal } from '@/lib/analytics/generation-result';
import { getKieJobStatus } from '@/lib/kie/browser';
import { KIE_MODELS } from '@/lib/kie/catalog';
import { isKieJobTerminal, KIE_JOB_TIMEOUT_MS, nextKiePollDelay } from '@/lib/kie/queue';
import type { KieJob, KieTask } from '@/lib/kie/types';
import { useAppStore } from '@/store/useAppStore';
import { useKieJobsStore } from '@/store/useKieJobsStore';
import { recordFinishedJob } from '@/lib/gallery/record-job';
import { playGenerationChime } from '@/lib/notify/chime';
import { captureKieJob } from '@/lib/spend/capture';
import { useQueuedJobPolling } from '@/lib/jobs/use-queued-job-polling';

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

function currentJob(id: string): KieJob | undefined {
  return useKieJobsStore.getState().jobs.find((job) => job.id === id);
}

export default function KieJobsProvider({ children }: { children: React.ReactNode }) {
  const apiKey = useAppStore((state) => state.kieApiKey).trim();
  const jobs = useKieJobsStore((state) => state.jobs);
  const upsertJob = useKieJobsStore((state) => state.upsertJob);

  useQueuedJobPolling<KieJob, KieTask>({
    jobs,
    apiKey,
    readApiKey: () => useAppStore.getState().kieApiKey.trim(),
    readJob: currentJob,
    upsertJob,
    isTerminal: (job) => isKieJobTerminal(job.state),
    signature: (job) => [job.taskId, job.protocol].join('\u0000'),
    timeoutMs: KIE_JOB_TIMEOUT_MS,
    nextDelay: nextKiePollDelay,
    // Kie waits for a key rather than timing a job out without one.
    timeoutWithoutKey: false,
    fetchStatus: (job, key, signal) =>
      getKieJobStatus({ apiKey: key, taskId: job.taskId, protocol: job.protocol }, { signal }),
    onTask: (job, task, key, now) => {
      // Poll stops at a terminal state, so this transition happens once.
      // A still-running poll is not a result.
      if (task.state === 'success') {
        reportKieTerminal(job, true);
        recordFinishedJob('kie', job, task.resultUrls[0]);
        captureKieJob(job, key, useKieJobsStore.getState().jobs);
        playGenerationChime();
      } else if (task.state === 'fail') {
        reportKieTerminal(job, false, task.error);
      }
      return { ...job, ...task, updatedAt: now, pollAttempt: job.pollAttempt + 1 };
    },
    // Kie fails the job rather than asking again: the task is not resubmitted.
    onPollError: (job, error, now) => {
      const message = error instanceof Error ? error.message : 'Kie status check failed. The task was not resubmitted.';
      reportKieTerminal(job, false, message);
      return { ...job, state: 'fail', error: message, updatedAt: now };
    },
    onTimeout: (job, now) => {
      reportKieTerminal(job, false, KIE_TIMEOUT_MESSAGE);
      return { ...job, state: 'fail', error: KIE_TIMEOUT_MESSAGE, updatedAt: now };
    },
  });

  return children;
}
