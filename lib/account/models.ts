import { DEFAULT_GEMINI_IMAGE_MODEL } from '../engines/gemini-catalog';

/** Fixed engines share identifiers between the browser request and Worker validation. */
export const SINGLE_IMAGE_MODELS = {
  // Same id the picker and the ledger fall back to. Pro stays selectable; it is no longer the unnamed default.
  gemini: DEFAULT_GEMINI_IMAGE_MODEL,
  cloudflare: '@cf/black-forest-labs/flux-1-schnell',
  pollinations: 'flux',
} as const;

/** What a person calls these models, kept beside the ids they name so the two
 *  cannot drift. The aggregators carry their own labels in their catalogs. */
export const SINGLE_IMAGE_MODEL_LABELS: Record<keyof typeof SINGLE_IMAGE_MODELS,string> = {
  gemini: 'Nano Banana 2.1',
  cloudflare: 'FLUX.1 [schnell]',
  pollinations: 'FLUX',
};
