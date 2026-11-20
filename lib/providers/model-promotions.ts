// lib/providers/model-promotions.ts
/**
 * Dated vendor sales, resolved at call time.
 *
 * The catalog stores list prices. A sale lives here as a window with the rates
 * it replaces, and `withModelSale` hands back a re-priced copy of the model
 * only while that window is open. A Worker loaded during a sale outlives it,
 * so nothing may read a sale rate at import: every price surface (picker,
 * button estimate, ledger, agent `list_models`) calls `withModelSale` with the
 * time it is pricing for, and a saved job passes its submission time so a clip
 * started during the sale keeps the sale rate when it finishes after it.
 *
 * Runware's Kling VIDEO 4.0 Flash sale keeps its own module
 * (`kling-4-flash-promo.ts`); `withModelSale` applies it too, so call sites
 * need one function.
 *
 * `startsAt` is the first day the offer was read on the vendor's page, not the
 * day it began: a later read must not invent a discount for an older job.
 */
import { withKling4FlashSale } from './kling-4-flash-promo';
import type { ProviderModel, ProviderRate } from './types';

export interface ModelPromotion {
  /** Vendor model ids the offer covers, verbatim. */
  modelIds: readonly string[];
  startsAt: number;
  /** Exclusive: the first instant list price applies again. */
  endsAt: number;
  /** Replaces `price`. */
  price: string;
  rate: ProviderRate;
  /** Replaces `referenceRate` on a model that has one. */
  referenceRate?: ProviderRate;
  /** Appended to the model's note while the offer runs. */
  note: string;
}

export const HEYGEN_VIDEO_MODEL = 'heygen:video@1.0';

/**
 * Read 2026-11-19 from https://runware.ai/docs/models/heygen-video-1-0:
 * "50% OFF until November 30, 2026", with every rate on the page halved. The
 * page names no timezone, the same gap as the Kling VIDEO 4.0 Flash and fal H3
 * offers, so this keeps the sale through the end of that UTC day and returns
 * to list at December 1, 00:00 UTC.
 */
export const HEYGEN_VIDEO_PROMOTION: ModelPromotion = {
  modelIds: [HEYGEN_VIDEO_MODEL],
  startsAt: Date.parse('2026-11-19T00:00:00Z'),
  endsAt: Date.parse('2026-12-01T00:00:00Z'),
  price: '$0.01 / s @ 480p · $0.018 @ 768p · $0.05 @ 1080p and 2K',
  rate: { usdByResolution: { '480p': 0.01, '768p': 0.018, '1080p': 0.05, '2K': 0.05 }, per: 'second' },
  referenceRate: {
    usdByResolution: { '480p': 0.035, '768p': 0.05, '1080p': 0.09, '2K': 0.09 },
    per: 'second',
    extraInputImageUsd: 0.02,
    includedInputImages: 2,
  },
  note: '50% off through Nov 30: $0.01 / s at 480p, $0.018 at 768p, $0.05 at 1080p and 2K; from references $0.035, $0.05 and $0.09, plus $0.02 for each image after the first two.',
};

export const ATLAS_SEEDANCE_25_FLASH_MODELS = [
  'bytedance/seedance-2.5-flash/text-to-video',
  'bytedance/seedance-2.5-flash/image-to-video',
  'bytedance/seedance-2.5-flash/reference-to-video',
] as const;

/**
 * Read 2026-11-19 from https://www.atlascloud.ai/ ("Get 35% off Seedance 2.5
 * Flash — up from 20%, through Nov 30") and the calculator, which returns
 * `discount: "65"` on every Flash quote: $0.1589/s at 720p and $0.0734/s at
 * 480p for the largest frame, against the list prices in the catalog.
 *
 * Atlas does name the end: the banner's countdown runs to `endAt:
 * 1796054340000`, which is 2026-11-30 15:59:00 UTC (23:59 in UTC+8). That
 * instant is used as published. It is earlier than the end of the UTC day, so
 * the last hours of Nov 30 estimate at list, never under it.
 *
 * What follows the sale is not published ("up from 20%" suggests a smaller
 * discount may return). Until it is read, list is the estimate.
 */
export const ATLAS_SEEDANCE_25_FLASH_PROMOTION: ModelPromotion = {
  modelIds: ATLAS_SEEDANCE_25_FLASH_MODELS,
  startsAt: Date.parse('2026-11-19T00:00:00Z'),
  endsAt: 1_796_054_340_000,
  price: '$0.0734 / s @ 480p · $0.1589 @ 720p',
  rate: { usdByResolution: { '480p': 0.0734, '720p': 0.1589 }, per: 'second' },
  note: '35% off through Nov 30: about $0.0734 / s at 480p and $0.1589 at 720p.',
};

export const MODEL_PROMOTIONS: readonly ModelPromotion[] = [
  HEYGEN_VIDEO_PROMOTION,
  ATLAS_SEEDANCE_25_FLASH_PROMOTION,
];

/** The dated offer open for this model at `at`, or undefined. */
export function modelPromotionAt(modelId: string | undefined, at = Date.now()): ModelPromotion | undefined {
  if (!modelId) return undefined;
  return MODEL_PROMOTIONS.find((promotion) =>
    promotion.modelIds.includes(modelId) && at >= promotion.startsAt && at < promotion.endsAt);
}

const saleCopies = new WeakMap<ProviderModel, ProviderModel>();

function saleCopy(model: ProviderModel, promotion: ModelPromotion): ProviderModel {
  const cached = saleCopies.get(model);
  if (cached) return cached;
  const copy: ProviderModel = {
    ...model,
    price: promotion.price,
    rate: promotion.rate,
    ...(model.referenceRate && promotion.referenceRate ? { referenceRate: promotion.referenceRate } : {}),
    note: model.note ? `${model.note} ${promotion.note}` : promotion.note,
  };
  saleCopies.set(model, copy);
  return copy;
}

/**
 * The model as priced at `at`: a sale copy inside an open window, otherwise
 * the same catalog object. One model has at most one offer, so the copy is
 * cached per model: the workspace keys effects on the selected model's
 * identity, and a fresh object each render would re-run them.
 */
export function withModelSale<T extends ProviderModel | undefined>(model: T, at = Date.now()): T {
  if (!model) return model;
  const promotion = modelPromotionAt(model.id, at);
  if (promotion) return saleCopy(model, promotion) as T;
  return withKling4FlashSale(model, at);
}
