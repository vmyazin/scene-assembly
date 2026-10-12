// lib/providers/follow-video.ts
import type { ProviderTask } from './types';

/** Shared with the workspace poll and a guest finalize. Sixty attempts from a 3s start. */
export const MAX_POLL_ATTEMPTS = 60;

export interface FollowVideoPatch {
  state: ProviderTask['state'];
  progress?: number;
  urls?: string[];
  cost?: number;
  error?: string;
  draftId?: string;
  pollAttempt?: number;
}

/**
 * Follows one provider task until it finishes, fails, or the attempt cap hits.
 *
 * A thrown status call and a timeout both report `state: 'error'` through
 * `onUpdate` before they return, so a guest finalize cannot stay `running`.
 * Once the task has succeeded, `onSuccess` is what files the gallery and the
 * ledger. It is tried twice. A second failure is rethrown without putting the
 * job back to error: the paid video is already on the job.
 */
export async function followProviderVideo(args: {
  startedAttempt?: number;
  maxAttempts?: number;
  delayMs?: (attempt: number) => number;
  timeoutMessage: string;
  poll: () => Promise<ProviderTask>;
  onUpdate: (patch: FollowVideoPatch) => void;
  onSuccess: (task: ProviderTask) => void | Promise<void>;
}): Promise<{ outcome: 'success' | 'error' | 'timeout'; error?: string }> {
  const max = args.maxAttempts ?? MAX_POLL_ATTEMPTS;
  const delay = args.delayMs ?? (() => 0);
  let attempt = args.startedAttempt ?? 0;
  while (attempt < max) {
    await new Promise((resolve) => setTimeout(resolve, delay(attempt)));
    attempt += 1;
    let task: ProviderTask;
    try {
      task = await args.poll();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Polling failed.';
      args.onUpdate({ state: 'error', error: message, pollAttempt: attempt });
      throw cause instanceof Error ? cause : new Error(message);
    }
    args.onUpdate({
      state: task.state,
      progress: task.progress,
      urls: task.urls,
      cost: task.cost,
      error: task.error,
      ...(task.draftId ? { draftId: task.draftId } : {}),
      pollAttempt: attempt,
    });
    if (task.state === 'success') {
      try {
        await args.onSuccess(task);
      } catch {
        await args.onSuccess(task);
      }
      return { outcome: 'success' };
    }
    if (task.state === 'error') return { outcome: 'error', error: task.error };
  }
  args.onUpdate({ state: 'error', error: args.timeoutMessage, pollAttempt: attempt });
  return { outcome: 'timeout', error: args.timeoutMessage };
}
