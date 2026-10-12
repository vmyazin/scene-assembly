// lib/providers/guest-finalize.ts
import { captureProviderJob } from '@/lib/spend/capture';
import { recordFinishedJob } from '@/lib/gallery/record-job';
import { playGenerationChime } from '@/lib/notify/chime';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';
import { finalizeProviderDraft, getProviderVideoStatus, pollDelayMs } from './browser';
import type { ProviderMode } from './types';

const MAX_POLL_ATTEMPTS = 60;

/**
 * Starts a 1080p finalize in the browser and follows it the same way the
 * workspace follows a generation: the job store, then the gallery and ledger.
 */
export async function runGuestFinalize(args: {
  apiKey: string;
  modelId: string;
  prompt: string;
  inputMode: ProviderMode;
  draftId: string;
  durationSeconds: number;
}): Promise<void> {
  const taskId = await finalizeProviderDraft({
    provider: 'runware', apiKey: args.apiKey, model: args.modelId, draftId: args.draftId,
  });
  const jobId = useProviderJobsStore.getState().startJob({
    provider: 'runware',
    taskId,
    modelId: args.modelId,
    prompt: args.prompt,
    inputMode: args.inputMode,
    controlValues: { finalize: true, draftId: args.draftId, durationSeconds: args.durationSeconds },
    state: 'queued',
    urls: [],
  });
  let attempt = 0;
  while (attempt < MAX_POLL_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, pollDelayMs(attempt)));
    attempt += 1;
    const task = await getProviderVideoStatus({ provider: 'runware', apiKey: args.apiKey, taskId });
    useProviderJobsStore.getState().patchJob(jobId, {
      state: task.state, progress: task.progress, urls: task.urls, cost: task.cost, error: task.error, pollAttempt: attempt,
    });
    if (task.state === 'success') {
      const job = useProviderJobsStore.getState().jobs.find((entry) => entry.id === jobId);
      recordFinishedJob('runware', {
        id: jobId, mediaType: 'video', prompt: args.prompt, modelId: args.modelId, inputMode: args.inputMode,
        controlValues: job?.controlValues, mimeType: 'video/mp4',
      }, task.urls[0]);
      if (job) captureProviderJob('runware', job, task);
      playGenerationChime();
      return;
    }
    if (task.state === 'error') throw new Error(task.error || 'Runware could not finalize this draft.');
  }
  throw new Error('Runware is still working on this finalize. It was not submitted again.');
}
