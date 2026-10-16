// lib/spend/palette.ts
import type { SpendProvider } from './ledger';

/**
 * Chart fills per provider, one hue each, assigned in `PROVIDER_ORDER` so the
 * colours that stack next to each other are the ones checked against each
 * other. Five neon tokens used to cover nine providers at different opacities,
 * which made Gemini and PiAPI the same cyan in the legend (UX audit L4).
 *
 * The eight hues are the dataviz reference palette's dark steps, validated
 * on this chart's surface (#0f1416): lightness band, chroma floor, adjacent
 * CVD ΔE >= 8.4 and normal-vision ΔE >= 19.3, all >= 3:1. Cloudflare (free
 * tier) and the micro-AI line (fractions of a cent) are the folded "other"
 * slots past eight, so they take neutral greys rather than a ninth hue.
 * A fill follows its provider, never its rank: a day without Gemini spend
 * does not repaint fal.
 */
export const PROVIDER_FILL: Record<SpendProvider, { color: string; opacity: number }> = {
  gemini: { color: '#3987e5', opacity: 1 },
  fal: { color: '#d95926', opacity: 1 },
  kie: { color: '#199e70', opacity: 1 },
  runware: { color: '#c98500', opacity: 1 },
  atlas: { color: '#d55181', opacity: 1 },
  comet: { color: '#008300', opacity: 1 },
  piapi: { color: '#9085e9', opacity: 1 },
  pollinations: { color: '#e66767', opacity: 1 },
  cloudflare: { color: '#a3a3a0', opacity: 1 },
  'micro-ai': { color: '#6b6b68', opacity: 1 },
};

/** Stack order, so the same provider always sits at the same height. */
export const PROVIDER_ORDER: SpendProvider[] = [
  'gemini', 'fal', 'kie', 'runware', 'atlas', 'comet', 'piapi', 'pollinations', 'cloudflare', 'micro-ai',
];
