// components/FalJobsProvider.tsx
'use client';

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
import { useQueuedJobPolling } from '@/lib/jobs/use-queued-job-polling';

const FAL_TIMEOUT_MESSAGE =
  'Polling stopped after 15 minutes. The fal job may still complete upstream.';

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
  const apiKey = useAppStore((state) => state.falApiKey).trim();
  const jobs = useFalJobsStore((state) => state.jobs);
  const upsertJob = useFalJobsStore((state) => state.upsertJob);

  useQueuedJobPolling<FalJob, FalTask>({
    jobs,
    apiKey,
    readApiKey: () => useAppStore.getState().falApiKey.trim(),
    readJob: currentJob,
    upsertJob,
    isTerminal: (job) => isFalJobTerminal(job.state),
    signature: jobSignature,
    timeoutMs: FAL_JOB_TIMEOUT_MS,
    nextDelay: nextFalPollDelay,
    // The deadline is local, so it holds whether or not a key is connected.
    timeoutWithoutKey: true,
    fetchStatus: (job, key, signal) =>
      getFalJobStatus(
        {
          apiKey: key,
          modelId: job.modelId,
          mediaType: job.mediaType,
          inputMode: job.inputMode,
          requestId: job.requestId,
        },
        { signal }
      ),
    onTask: (job, task, key, now) => {
      // Poll stops at a terminal state, so this transition happens once.
      // Running and queued updates are not a result: a later refusal would
      // otherwise already have been counted as a success.
      if (task.state === 'success') {
        reportFalTerminal(job, true);
        recordFinishedJob('fal', { ...job, mimeType: task.mimeType }, task.resultUrl);
        captureFalJob(job, key);
        playGenerationChime();
      } else if (task.state === 'fail' || task.state === 'timed_out') {
        reportFalTerminal(job, false, task.error);
      }
      return taskSnapshot(job, task, now);
    },
    // A failed status call is not a failed job: the next attempt asks again.
    onPollError: (job, _error, now) => ({ ...job, error: undefined, updatedAt: now, pollAttempt: job.pollAttempt + 1 }),
    onTimeout: (job, now) => {
      reportFalTerminal(job, false, FAL_TIMEOUT_MESSAGE);
      return timedOutJob(job, now);
    },
  });

  return children;
}
