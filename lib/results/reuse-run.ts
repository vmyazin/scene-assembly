import type { DraftValue } from '@/lib/draft/carry-over';
import type { CloudJobRequest, CloudProvider } from '@/lib/account/contracts';
import { jobModelLabel } from '@/lib/account/job-label';
import { studioLocationForJob } from '@/lib/account/job-location';
import { findGeminiVideoModel } from '@/lib/engines/gemini-video-catalog';
import { useDraftStore } from '@/store/useDraftStore';

/** What a saved result remembers about the run that made it. Browser records
 *  and cloud assets both carry this much, under different field names. */
export interface SavedRun {
  provider: string;
  modelId?: string;
  mediaType: 'image' | 'video';
  inputMode?: string;
  prompt: string;
  values: Record<string, DraftValue>;
}

const INPUT_MODES: readonly CloudJobRequest['inputMode'][] = ['text', 'image', 'frames', 'reference', 'edit'];

/**
 * The model's display name, for a library card.
 *
 * `jobModelLabel` reads image catalogs for Gemini, so a Gemini video would be
 * named after the default image model; the video catalog answers that case.
 */
export function resultModelLabel(run: Pick<SavedRun, 'provider' | 'modelId' | 'mediaType'>): string | null {
  if (!run.modelId) return null;
  if (run.provider === 'gemini' && run.mediaType === 'video') return findGeminiVideoModel(run.modelId)?.label ?? run.modelId;
  return jobModelLabel(run.provider as CloudProvider, run.modelId);
}

/**
 * "Do that again": selects the model the result was made with, then loads its
 * prompt and settings into the draft. Returns the studio address to open, or
 * `null` when no workspace runs that model (an imported clip, a local test).
 *
 * The model is chosen before the settings are replayed because the draft's
 * controls are read against the selected model; replaying first would let the
 * previous model's guard drop values the right one accepts.
 */
export function reuseRun(run: SavedRun): string | null {
  const inputMode = INPUT_MODES.find((mode) => mode === run.inputMode) ?? 'text';
  const location = run.modelId
    ? studioLocationForJob({
        provider: run.provider as CloudProvider,
        modelId: run.modelId,
        mediaType: run.mediaType,
        inputMode,
      })
    : null;
  location?.select();
  const draft = useDraftStore.getState();
  draft.setPrompt(run.prompt);
  draft.rememberControlValues(run.values);
  return location?.href ?? null;
}
