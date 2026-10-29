// lib/engines/registry.ts
import type { Feature } from '../../types';

// Dependency-free engine metadata + capability gating. Safe to import from both
// client components and server routes (no provider SDKs here).

export type EngineId =
  | 'gemini'
  | 'pollinations'
  | 'cloudflare'
  | 'kie'
  | 'fal'
  | 'runware'
  | 'atlas'
  | 'comet'
  | 'piapi';

/** UI names describe the provider alone; model names belong in the model field. */
export const PROVIDER_LABELS: Record<EngineId, string> = {
  gemini: 'Google Gemini',
  pollinations: 'Pollinations',
  cloudflare: 'Cloudflare',
  kie: 'Kie.ai',
  fal: 'fal.ai',
  runware: 'Runware',
  atlas: 'Atlas Cloud',
  comet: 'CometAPI',
  piapi: 'PiAPI',
};

export interface EngineMeta {
  id: EngineId;
  label: string;
  blurb: string;
  /** Requires the user to supply credentials (stored client-side). */
  requiresApiKey: boolean;
  /** Can accept uploaded reference images (editing / composition / style). */
  supportsInputImages: boolean;
  /** Can ground generation with Google Search. */
  supportsGoogleSearch: boolean;
  /** Honors the aspect-ratio control. */
  supportsAspectRatio: boolean;
  /** Honors the image-quality (1K/2K/4K) control. */
  supportsImageSize: boolean;
  /** Free to use (free tier / no cost). */
  free: boolean;
  /**
   * Short code appended to download filenames for engines that run one fixed
   * model, e.g. `gemini-3-pro-image`. Absent on the aggregators (kie, fal,
   * runware, atlas, comet), where the code comes from the model the user picked
   * in that provider's own catalog.
   */
  fileCode?: string;
}

// Image display ranking: cost + quality + exposed variety + operational confidence.
// Rationale: docs/codex/specs/2026-10-26-provider-ranking.md. Keep saved choices.
export const ENGINES: EngineMeta[] = [
  {
    id: 'atlas',
    label: PROVIDER_LABELS.atlas,
    blurb: 'Image, video, and LLMs on one key — FLUX schnell from $0.003',
    requiresApiKey: true,
    supportsInputImages: true,
    supportsGoogleSearch: false,
    supportsAspectRatio: true,
    supportsImageSize: false,
    free: false,
  },
  {
    id: 'gemini',
    label: PROVIDER_LABELS.gemini,
    blurb: 'Nano Banana 2.1 — every mode, your API key',
    requiresApiKey: true,
    supportsInputImages: true,
    supportsGoogleSearch: true,
    supportsAspectRatio: true,
    supportsImageSize: true,
    free: false,
    fileCode: 'gemini-3-pro-image',
  },
  {
    id: 'kie',
    label: PROVIDER_LABELS.kie,
    blurb: 'Image and video, on your own Kie key',
    requiresApiKey: true,
    supportsInputImages: true,
    supportsGoogleSearch: false,
    supportsAspectRatio: true,
    supportsImageSize: true,
    free: false,
  },
  {
    id: 'runware',
    label: PROVIDER_LABELS.runware,
    blurb: 'Cheapest per image — Z-Image Turbo and FLUX, on your own Runware key',
    requiresApiKey: true,
    supportsInputImages: true,
    supportsGoogleSearch: false,
    supportsAspectRatio: true,
    supportsImageSize: false,
    free: false,
  },
  {
    id: 'fal',
    label: PROVIDER_LABELS.fal,
    blurb: 'Nano Banana 2.1, on your own fal key',
    requiresApiKey: true,
    supportsInputImages: true,
    supportsGoogleSearch: true,
    supportsAspectRatio: true,
    supportsImageSize: true,
    free: false,
  },
  {
    id: 'piapi', label: PROVIDER_LABELS.piapi,
    blurb: 'Nano Banana 2, Veo Fast and Kling Omni on your PiAPI key',
    requiresApiKey: true, supportsInputImages: true, supportsGoogleSearch: false,
    supportsAspectRatio: true, supportsImageSize: true, free: false,
  },
  {
    id: 'comet',
    label: PROVIDER_LABELS.comet,
    blurb: 'Broad commercial coverage behind an OpenAI-compatible interface',
    requiresApiKey: true,
    supportsInputImages: false,
    supportsGoogleSearch: false,
    supportsAspectRatio: true,
    supportsImageSize: false,
    free: false,
  },
  {
    id: 'cloudflare',
    label: PROVIDER_LABELS.cloudflare,
    blurb: 'Free daily tier · FLUX.1 [schnell] · Cloudflare token',
    requiresApiKey: true,
    supportsInputImages: false,
    supportsGoogleSearch: false,
    supportsAspectRatio: false,
    supportsImageSize: false,
    free: true,
    fileCode: 'flux-1-schnell',
  },
  {
    id: 'pollinations',
    label: PROVIDER_LABELS.pollinations,
    blurb: 'Free · text-to-image · no key required',
    requiresApiKey: false,
    supportsInputImages: false,
    supportsGoogleSearch: false,
    supportsAspectRatio: true,
    supportsImageSize: false,
    free: true,
    fileCode: 'flux',
  },
];


/** Whether an engine can run a given feature mode. */
export function engineSupportsFeature(engine: EngineMeta, feature: Feature): boolean {
  if (feature.requiresImage && !engine.supportsInputImages) return false;
  // Search-grounded visualization is meaningless without real grounding.
  if (feature.id === 'search-grounding' && !engine.supportsGoogleSearch) return false;
  return true;
}

export function enginesForFeature(feature: Feature): EngineMeta[] {
  return ENGINES.filter((e) => engineSupportsFeature(e, feature));
}
