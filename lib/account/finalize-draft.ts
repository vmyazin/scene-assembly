// lib/account/finalize-draft.ts
'use client';

import { useAccountStore } from '@/store/useAccountStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import type { CloudJobRequest, CloudJobView } from './contracts';
import { warmAccountSlug } from './asset-name';
import { submitAccountJob } from './client';
import { refreshAccount } from './session';
import { seedanceFinalizeValuesError } from '@/lib/providers/seedance-draft';

/**
 * A finalize is a new account job. The prompt is kept for the library card
 * and is not sent to Runware; the adapter submits the draft id and 1080p only.
 */
export async function submitSeedanceFinalize(args: {
  prompt: string;
  inputMode: CloudJobRequest['inputMode'];
  modelId: string;
  draftId: string;
  durationSeconds: number;
}): Promise<CloudJobView> {
  const provider = 'runware' as const;
  const owner = useAccountStore.getState().session?.account?.id;
  if (!owner) throw new Error('Sign in again before finalizing this draft.');
  const epoch = useAccountStore.getState().epoch;
  const assertOwner = () => {
    const state = useAccountStore.getState();
    if (state.epoch !== epoch || state.session?.account?.id !== owner) throw new Error('Your account changed. Review the finalize before starting it.');
  };
  const problem = seedanceFinalizeValuesError({ finalize: true, draftId: args.draftId, durationSeconds: args.durationSeconds });
  if (problem) throw new Error(problem);
  const current = await refreshAccount();
  assertOwner();
  if (current.account?.id !== owner) throw new Error('Your account changed. Review the finalize before starting it.');
  if (!current.providers.includes(provider)) throw new Error('Background generation is not available for this provider yet.');
  if (!current.connections.some((connection) => connection.provider === provider)) throw new Error('Save your Runware connection in your account before finalizing.');
  const prompt = args.prompt.trim() || 'Finalize Seedance draft';
  const request: CloudJobRequest = {
    provider, modelId: args.modelId, mediaType: 'video', inputMode: args.inputMode, prompt,
    values: { finalize: true, draftId: args.draftId.trim(), durationSeconds: args.durationSeconds },
    referenceIds: [],
  };
  const { job } = await submitAccountJob(crypto.randomUUID(), request, undefined, owner);
  assertOwner();
  usePromptLibraryStore.getState().remember(prompt);
  warmAccountSlug(job.id, prompt);
  const state = useAccountStore.getState();
  if (state.session?.account?.id === owner) state.applyJobs(owner, state.epoch, [job, ...state.jobs.filter((entry) => entry.id !== job.id)], state.assets);
  return job;
}
