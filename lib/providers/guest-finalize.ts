// lib/providers/guest-finalize.ts
import { captureProviderJob } from '@/lib/spend/capture';
import { recordFinishedJob } from '@/lib/gallery/record-job';
import { playGenerationChime } from '@/lib/notify/chime';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';
import { finalizeProviderDraft, getProviderVideoStatus, pollDelayMs } from './browser';
import { followProviderVideo } from './follow-video';
import type { ProviderMode } from './types';

/**
 * Starts a 1080p finalize in the browser and follows it the same way the
 * workspace follows a generation: the job store, then the gallery and ledger.
 * A timeout or a thrown status call marks the job failed before the error
 * reaches the button, so a slow finalize cannot stay on screen as running.
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
  const result = await followProviderVideo({
    delayMs: pollDelayMs,
    timeoutMessage: 'Runware is still working on this finalize. It was not submitted again.',
    poll: () => getProviderVideoStatus({ provider: 'runware', apiKey: args.apiKey, taskId }),
    onUpdate: (patch) => useProviderJobsStore.getState().patchJob(jobId, patch),
    onSuccess: (task) => {
      const job = useProviderJobsStore.getState().jobs.find((entry) => entry.id === jobId);
      recordFinishedJob('runware', {
        id: jobId, mediaType: 'video', prompt: args.prompt, modelId: args.modelId, inputMode: args.inputMode,
        controlValues: job?.controlValues, mimeType: 'video/mp4',
      }, task.urls[0]);
      if (job) captureProviderJob('runware', job, task);
      playGenerationChime();
    },
  });
  if (result.outcome === 'error') throw new Error(result.error || 'Runware could not finalize this draft.');
  if (result.outcome === 'timeout') throw new Error(result.error || 'Runware is still working on this finalize. It was not submitted again.');
}
