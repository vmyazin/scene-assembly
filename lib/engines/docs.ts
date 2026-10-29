// lib/engines/docs.ts
import { PROVIDER_LABELS, type EngineId } from '@/lib/engines/registry';

/**
 * Where to read up on each engine we can call. These are the vendors' own API
 * docs — the page a developer needs to understand what a connected key buys
 * them, and what the engine can do beyond what this UI exposes.
 *
 * Shared because two surfaces list them: the footer's "Engine docs" row and the
 * ⌘K palette's Resources group. One list keeps a new engine from showing up in
 * only one of them.
 */
export const ENGINE_DOCS: ReadonlyArray<{
  id: EngineId;
  label: string;
  href: string;
  /** Hover accent, matched to the color each engine carries elsewhere. */
  accentClass: string;
}> = [
  {
    id: 'gemini',
    label: PROVIDER_LABELS.gemini,
    href: 'https://ai.google.dev/gemini-api/docs/image-generation',
    accentClass: 'hover:text-[var(--neon-cyan)]',
  },
  {
    id: 'pollinations',
    label: PROVIDER_LABELS.pollinations,
    href: 'https://gen.pollinations.ai/docs',
    accentClass: 'hover:text-[var(--neon-purple)]',
  },
  {
    id: 'cloudflare',
    label: PROVIDER_LABELS.cloudflare,
    href: 'https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/',
    accentClass: 'hover:text-[var(--brand-accent)]',
  },
  {
    id: 'fal',
    label: PROVIDER_LABELS.fal,
    href: 'https://fal.ai/docs',
    accentClass: 'hover:text-[var(--neon-pink)]',
  },
  {
    id: 'kie',
    label: PROVIDER_LABELS.kie,
    href: 'https://docs.kie.ai/',
    accentClass: 'hover:text-[var(--foreground)]',
  },
  {
    id: 'runware',
    label: PROVIDER_LABELS.runware,
    href: 'https://runware.ai/docs',
    accentClass: 'hover:text-[var(--neon-cyan)]',
  },
  {
    id: 'atlas',
    label: PROVIDER_LABELS.atlas,
    href: 'https://atlascloud.ai/docs',
    accentClass: 'hover:text-[var(--neon-purple)]',
  },
  { id: 'piapi', label: PROVIDER_LABELS.piapi, href: 'https://piapi.ai/docs', accentClass: 'hover:text-[var(--neon-cyan)]' },
  {
    id: 'comet',
    label: PROVIDER_LABELS.comet,
    href: 'https://apidoc.cometapi.com',
    accentClass: 'hover:text-[var(--neon-pink)]',
  },
];
