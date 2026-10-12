// lib/providers/browser.ts
import { RouteError } from './route-error';
import type { ProviderId, ProviderMode, ProviderTask } from './types';

/**
 * Client half of the aggregator video path. Talks only to our own route, so the
 * user's key travels one hop and no vendor origin is contacted from the page.
 */

interface VideoRouteResponse {
  success?: boolean;
  error?: string;
  taskId?: string;
  task?: ProviderTask;
}

async function post(body: Record<string, unknown>): Promise<VideoRouteResponse> {
  const response = await fetch('/api/providers/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as VideoRouteResponse;
  if (!response.ok || !data.success) {
    throw new RouteError(
      data.error || 'That provider could not complete the request.',
      response.status
    );
  }
  return data;
}

export async function submitProviderVideo(args: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  prompt: string;
  inputMode: ProviderMode;
  images?: string[];
  sourceVideo?: string;
  referenceVideos?: string[];
  referenceAudios?: string[];
  durationSeconds?: number;
  /** Label of the model's documented size, resolved to pixels on the server. */
  size?: string;
  audio?: boolean;
  draft?: boolean;
  aspectRatio?: string;
}): Promise<string> {
  const data = await post({ operation: 'create', ...args });
  if (!data.taskId) throw new Error('The provider did not return a task ID.');
  return data.taskId;
}

/** Finalize sends the draft id only. Prompt and media stay on the draft. */
export async function finalizeProviderDraft(args: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  draftId: string;
}): Promise<string> {
  const data = await post({ operation: 'finalize', provider: args.provider, apiKey: args.apiKey, model: args.model, draftId: args.draftId });
  if (!data.taskId) throw new Error('The provider did not return a task ID.');
  return data.taskId;
}

export async function getProviderVideoStatus(args: {
  provider: ProviderId;
  apiKey: string;
  taskId: string;
  sourceVideo?: string;
}): Promise<ProviderTask> {
  const data = await post({ operation: 'status', ...args });
  if (!data.task) throw new Error('The provider did not return the task status.');
  return data.task;
}

/**
 * Poll delay, growing with the attempt count. Runware's docs ask for
 * exponential backoff from 1–2s; Comet's ask for 10–20s. Starting at 3s and
 * easing to 15s respects both without making a 20-second clip feel stalled.
 */
export function pollDelayMs(attempt: number): number {
  return Math.min(15_000, 3_000 + attempt * 1_500);
}
