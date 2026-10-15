// lib/engines/gemini-catalog.ts
/**
 * The Gemini image models one Google AI Studio key can run.
 *
 * The engine used to be a single fixed model, and every consumer knew its id by
 * heart — the Worker's validator, the download namer, the ledger. They now all
 * read this list instead, so adding a fourth model is one entry rather than a
 * hunt. Dependency-free on purpose: it is imported from client components, from
 * server routes, and from the Cloudflare Worker.
 *
 * Labels are the names the studio has always shown, with Google's marketing
 * name for each model in its note: renaming the model someone already picks by
 * sight buys nothing, and a job saved last week still has to read the same.
 *
 * Capabilities are Google's, not ours:
 * https://ai.google.dev/gemini-api/docs/image-generation and
 * https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1, read 2026-10-15.
 * Prices live beside them in `lib/spend/rates.ts`, keyed by the ids here.
 */

export interface GeminiImageModel {
  id: string;
  label: string;
  /** Appended to a download filename, per `lib/download-name.ts`. */
  fileCode: string;
  /**
   * The `imageSize` values this model accepts, in the order the control shows
   * them. Google documents a 512px tier for Flash Image alone and spells its
   * parameter three different ways on one page, so it is deliberately absent:
   * a rejected enum costs a whole generation to discover.
   */
  sizes: string[];
  /** Whether the `googleSearch` tool may be sent. Lite refuses it outright. */
  supportsGoogleSearch: boolean;
  /** Reference images Google says the model takes, for the picker's Refs column. */
  maxInputImages: number;
  /** The vendor's own one-line description, shown under the picker. */
  note: string;
}

export const GEMINI_IMAGE_MODELS: GeminiImageModel[] = [
  {
    id: 'gemini-nano-banana-2.1',
    label: 'Nano Banana 2.1',
    fileCode: 'nano-banana-2_1',
    sizes: ['1K', '2K', '4K'],
    supportsGoogleSearch: true,
    maxInputImages: 14,
    note: 'Gemini Nano Banana 2.1 (gemini-nano-banana-2.1). High-efficiency image generation and editing at 1K, 2K and 4K, with Google Search grounding. The default.',
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2 (deprecated)',
    fileCode: 'gemini-3_1-flash-image',
    sizes: ['1K', '2K', '4K'],
    supportsGoogleSearch: true,
    maxInputImages: 14,
    note: 'Deprecated. Gemini 3.1 Flash Image (gemini-3.1-flash-image). Google recommends Nano Banana 2.1. Still available, and still grounds on Google Search.',
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image',
    fileCode: 'gemini-3-pro-image',
    sizes: ['1K', '2K', '4K'],
    supportsGoogleSearch: true,
    maxInputImages: 14,
    note: 'Nano Banana Pro. A professional design engine with a reasoning core for studio-quality 4K visuals, complex layouts, and precise text rendering.',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash Lite Image',
    fileCode: 'gemini-3_1-flash-lite-image',
    sizes: ['1K'],
    supportsGoogleSearch: false,
    maxInputImages: 14,
    note: 'Nano Banana 2 Lite. The cheapest and fastest of the family, for volume work. 1K only, no Google Search grounding, and not built for multi-reference editing.',
  },
];

/** What the studio runs when nobody has chosen. Nano Banana 2.1 replaced Nano Banana 2. */
export const DEFAULT_GEMINI_IMAGE_MODEL = GEMINI_IMAGE_MODELS[0].id;

export function findGeminiImageModel(modelId: string | undefined): GeminiImageModel | undefined {
  return GEMINI_IMAGE_MODELS.find((model) => model.id === modelId);
}

/**
 * The model a request should run, given a saved or submitted id. A retired or
 * unknown id falls back to the default rather than reaching the API: a
 * generation is paid for, and a 404 from Google says nothing useful here.
 */
export function resolveGeminiImageModel(modelId: string | undefined): GeminiImageModel {
  return findGeminiImageModel(modelId) ?? GEMINI_IMAGE_MODELS[0];
}

/** Models that can run this feature — the search-grounding mode needs grounding. */
export function geminiModelsForFeature(featureId: string): GeminiImageModel[] {
  return featureId === 'search-grounding'
    ? GEMINI_IMAGE_MODELS.filter((model) => model.supportsGoogleSearch)
    : GEMINI_IMAGE_MODELS;
}

/** The chosen size if this model takes it, else its smallest — never a rejected enum. */
export function geminiImageSize(model: GeminiImageModel, imageSize: string | undefined): string {
  return imageSize && model.sizes.includes(imageSize) ? imageSize : model.sizes[0];
}
