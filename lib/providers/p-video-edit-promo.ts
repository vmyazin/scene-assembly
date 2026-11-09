// lib/providers/p-video-edit-promo.ts
/**
 * Runware's P-Video-Edit sale, resolved at call time.
 *
 * Read 2026-11-03 from https://runware.ai/docs/models/prunaai-p-video-edit.
 * The page says "25% OFF until November 3, 2026" and names no timezone, the
 * same gap as fal's H3 Max Turbo offer. This app keeps the sale through the
 * end of that UTC day and drops it at November 4, 00:00 UTC. The known window
 * starts on the 2026-09-11 verification date so a late read never invents a
 * discount for an older job. List prices stay on the catalog entry; a Worker
 * loaded during the sale has to pick the rate when the job is priced, because
 * the process outlives the offer.
 */
import type { ProviderRate } from './types';

export const P_VIDEO_EDIT_MODEL = 'prunaai:p-video@edit';

export const P_VIDEO_EDIT_PROMOTION = {
  startsAt: Date.parse('2026-09-11T00:00:00Z'),
  endsAt: Date.parse('2026-11-04T00:00:00Z'),
  rate: { per: 'second', usd: 0.0338 } satisfies ProviderRate,
  draftRate: { per: 'second', usd: 0.0188 } satisfies ProviderRate,
};

export function pVideoEditPromotionActive(modelId: string | undefined, at = Date.now()): boolean {
  return modelId === P_VIDEO_EDIT_MODEL
    && at >= P_VIDEO_EDIT_PROMOTION.startsAt
    && at < P_VIDEO_EDIT_PROMOTION.endsAt;
}

/** Sale copy beside the model note. Null once the window has closed, and for every other model. */
export function pVideoEditPromotionNote(modelId: string | undefined, at = Date.now()): string | null {
  return pVideoEditPromotionActive(modelId, at) ? '25% off through Nov 3.' : null;
}

/**
 * Sale rates while the offer is open, or null so the caller keeps the catalog
 * list price ($0.045/s standard, $0.025/s draft).
 */
export function pVideoEditRates(
  modelId: string | undefined,
  at = Date.now(),
): { rate: ProviderRate; draftRate: ProviderRate } | null {
  return pVideoEditPromotionActive(modelId, at)
    ? { rate: P_VIDEO_EDIT_PROMOTION.rate, draftRate: P_VIDEO_EDIT_PROMOTION.draftRate }
    : null;
}
