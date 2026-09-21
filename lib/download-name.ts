// lib/download-name.ts
import { ENGINES } from '@/lib/engines/registry';
import { findGeminiImageModel } from '@/lib/engines/gemini-catalog';
import { findGeminiVideoModel } from '@/lib/engines/gemini-video-catalog';
import { FAL_IMAGE_MODEL, FAL_VIDEO_MODELS } from '@/lib/fal/catalog';
import { KIE_MODELS } from '@/lib/kie/catalog';
import { fallbackFilenameBase, type DownloadMediaType } from '@/lib/media-download';
import { PROVIDER_MODELS } from '@/lib/providers/catalog';
import type { ProviderId } from '@/lib/providers/types';

/**
 * Naming a download after the model that made it.
 *
 * Every catalog carries a `fileCode` beside its model definition — `wan-2_7`,
 * `kling-3-pro` — and this is the one place that reads them, so a filename says
 * what produced it once the file has left the app: `neon-tiger-wan-2_7.mp4`.
 */

/** Last resort for a model that is no longer in its catalog (retired, or renamed). */
function sanitizedCode(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/\./g, '_')
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The filename code for a model, or undefined when nothing identifies it. */
export function modelFileCode(provider?: string, modelId?: string): string | undefined {
  // Gemini is a fixed-model engine that grew a catalog: a run says which of the
  // three made it, so its code has to come from the model before the engine's
  // own fallback answers "gemini-3-pro-image" for a Lite image.
  if (provider === 'gemini' && modelId) {
    const known = findGeminiImageModel(modelId) ?? findGeminiVideoModel(modelId);
    if (known) return known.fileCode;
  }
  if (provider && modelId) {
    const catalog =
      provider === 'fal'
        ? [FAL_IMAGE_MODEL, ...FAL_VIDEO_MODELS]
        : provider === 'kie'
          ? KIE_MODELS
          : PROVIDER_MODELS[provider as ProviderId];
    const known = catalog?.find((model) => model.id === modelId);
    if (known) return known.fileCode;
  }

  // Engines that run one fixed model (Gemini, Pollinations, Cloudflare) name it
  // themselves; the aggregators leave it to the model above.
  const engineCode = ENGINES.find((engine) => engine.id === provider)?.fileCode;
  if (engineCode) return engineCode;

  return modelId ? sanitizedCode(modelId) || undefined : undefined;
}

/**
 * Download filename without its extension: the prompt slug the app already used,
 * with the model's code appended.
 */
export function downloadFilenameBase(args: {
  prompt: string;
  mediaType: DownloadMediaType;
  slug?: string;
  provider?: string;
  modelId?: string;
}): string {
  const base = args.slug || fallbackFilenameBase(args.prompt, args.mediaType);
  const code = modelFileCode(args.provider, args.modelId);
  return code ? `${base}-${code}` : base;
}
