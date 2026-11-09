// lib/providers/kling-4-flash-promo.ts
/**
 * Runware's Kling VIDEO 4.0 Flash sale, resolved at call time.
 *
 * Read 2026-11-09 from https://runware.ai/docs/models/klingai-video-4-0-flash.
 * The page shows 15% off until November 10, 2026 and names no timezone, the
 * same gap as fal's H3 Max Turbo offer. This app keeps the sale through the
 * end of that UTC day and drops it at November 11, 00:00 UTC. The known window
 * starts on the model's November 4 release so a late read never invents a
 * discount for an older job.
 *
 * List prices stay on the catalog entry. A Worker loaded during the sale has
 * to pick the rate when the job is priced, because the process outlives the
 * offer.
 */
import type { ProviderModel, ProviderRate } from './types';

export const KLING_4_FLASH_MODEL = 'klingai:kling-video@4.0-flash';

export const KLING_4_FLASH_PROMOTION = {
  startsAt: Date.parse('2026-11-04T00:00:00Z'),
  endsAt: Date.parse('2026-11-11T00:00:00Z'),
  /** No video input: text, image, and reference-image runs. */
  rate: { per: 'second', usd: 0.0799 } satisfies ProviderRate,
  /** A source video is on the request. */
  videoInputRate: { per: 'second', usd: 0.107 } satisfies ProviderRate,
};

export function kling4FlashPromotionActive(modelId: string | undefined, at = Date.now()): boolean {
  return modelId === KLING_4_FLASH_MODEL
    && at >= KLING_4_FLASH_PROMOTION.startsAt
    && at < KLING_4_FLASH_PROMOTION.endsAt;
}

const saleCopies = new WeakMap<ProviderModel, ProviderModel>();

function saleCopy(model: ProviderModel): ProviderModel {
  const cached = saleCopies.get(model);
  if (cached) return cached;
  const copy: ProviderModel = {
    ...model,
    price: '$0.0799 / s',
    rate: KLING_4_FLASH_PROMOTION.rate,
    note: `${model.note} 15% off through Nov 10: $0.0799 per second.`,
    ...(model.videoEdit ? {
      videoEdit: {
        ...model.videoEdit,
        rate: KLING_4_FLASH_PROMOTION.videoInputRate,
        note: `${model.videoEdit.note} 15% off through Nov 10: $0.107 per second.`,
      },
    } : {}),
  };
  saleCopies.set(model, copy);
  return copy;
}

/**
 * The model as priced at `at`: a sale copy inside the window for this one
 * model, otherwise the same catalog object. The copy is cached per model
 * because the workspace keys effects on the selected model's identity.
 *
 * Callers pass a saved job's submission time, so a clip started during the
 * sale keeps the sale rate when it finishes after the window closes.
 */
export function withKling4FlashSale<T extends ProviderModel | undefined>(model: T, at = Date.now()): T {
  return model && kling4FlashPromotionActive(model.id, at) ? saleCopy(model) as T : model;
}
