// lib/gallery/record-job.ts
import type { GalleryKind } from '@/lib/gallery/storage';
import { useGalleryStore } from '@/store/useGalleryStore';

interface FinishedJob {
  id: string;
  prompt: string;
  slug?: string;
  modelId: string;
  mediaType: GalleryKind;
  inputMode: string;
  controlValues?: Record<string, string | number | boolean>;
  mimeType?: string;
  draftId?: string;
}

/**
 * Files a finished provider job as a gallery record — metadata only.
 *
 * Nothing is downloaded here on purpose. Deriving a poster frame would require
 * pulling the whole video down, which is exactly the cost that keeping video
 * "on request" is meant to avoid. The card previews from the provider URL while
 * that URL is alive, and Keep fetches the bytes once when the user asks.
 */
export function recordFinishedJob(
  provider: 'kie' | 'fal' | 'runware' | 'atlas' | 'comet' | 'piapi',
  job: FinishedJob,
  resultUrl: string | undefined
) {
  if (!resultUrl) return;

  void useGalleryStore.getState().record({
    // Keyed by the provider job so a re-poll cannot file it twice.
    id: `${provider}-${job.id}`,
    kind: job.mediaType,
    prompt: job.prompt,
    slug: job.slug,
    provider,
    modelId: job.modelId,
    inputMode: job.inputMode,
    controlValues: job.controlValues ?? {},
    mimeType: job.mimeType ?? (job.mediaType === 'video' ? 'video/mp4' : 'image/png'),
    ...(job.draftId ? { draftId: job.draftId } : {}),
    sourceUrl: resultUrl,
  });
}
