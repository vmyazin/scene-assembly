import { falModelLabel } from '@/lib/fal/catalog';
import { KIE_MODELS } from '@/lib/kie/catalog';
import { findModel } from '@/lib/providers/catalog';
import type { ProviderId } from '@/lib/providers/types';
import { findGeminiImageModel } from '@/lib/engines/gemini-catalog';
import { SINGLE_IMAGE_MODELS, SINGLE_IMAGE_MODEL_LABELS } from './models';
import type { CloudJobRequest, CloudProvider } from './contracts';

/** The name a person chose the model by, not the id the API takes. Every provider
 *  keeps its own catalog, so this is the single place that knows all of them.
 *  A model retired since the job ran falls back to its id: a stale name still
 *  identifies the run, an empty one does not. */
/** Only these three are in the shared provider catalog; findModel throws on any
 *  other key, and CloudProvider carries values it does not know — `local-test`
 *  reaches a real browser in local development. */
const CATALOG_PROVIDERS: ProviderId[] = ['runware', 'atlas', 'comet', 'piapi'];

export function jobModelLabel(provider: CloudProvider, modelId: string): string {
  if (provider === 'fal') return falModelLabel(modelId);
  if (provider === 'kie') return KIE_MODELS.find(model => model.id === modelId)?.label ?? modelId;
  // A catalogued id keeps the name it was chosen by. An id this catalog does not
  // know ran as the current default, so the fallback label names that model.
  if (provider === 'gemini') return findGeminiImageModel(modelId)?.label ?? SINGLE_IMAGE_MODEL_LABELS.gemini;
  if (provider in SINGLE_IMAGE_MODEL_LABELS) return SINGLE_IMAGE_MODEL_LABELS[provider as keyof typeof SINGLE_IMAGE_MODELS];
  if (CATALOG_PROVIDERS.includes(provider as ProviderId)) return findModel(provider as ProviderId, modelId)?.label ?? modelId;
  return modelId;
}

/** "Video, Seedance 2.0 Mini" — what was asked for, in one line. */
export function jobSummary(request: Pick<CloudJobRequest,'provider'|'modelId'|'mediaType'>): string {
  return `${request.mediaType === 'video' ? 'Video' : 'Image'}, ${jobModelLabel(request.provider, request.modelId)}`;
}
