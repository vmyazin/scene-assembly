// tests/spend/model-promotions.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudJobRequest } from '@/lib/account/contracts';
import { describeModels } from '@/lib/account/model-schema';
import { providerImageSpecs, providerVideoSpecs } from '@/lib/models/listbox-specs';
import {
  ATLAS_KLING_40_FLASH_QUOTED_USD,
  findModel,
  KLING_IMAGE_40_QUOTED_USD,
  modelsFor,
  PROVIDER_MODELS,
} from '@/lib/providers/catalog';
import { KLING_4_FLASH_MODEL, KLING_4_FLASH_PROMOTION } from '@/lib/providers/kling-4-flash-promo';
import {
  ATLAS_SEEDANCE_25_FLASH_MODELS,
  ATLAS_SEEDANCE_25_FLASH_PROMOTION,
  HEYGEN_VIDEO_MODEL,
  HEYGEN_VIDEO_PROMOTION,
  MODEL_PROMOTIONS,
  modelPromotionAt,
  withModelSale,
} from '@/lib/providers/model-promotions';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { resolveCatalogRate } from '@/lib/spend/resolve';

const RUNWARE_FLASH = 'bytedance:seedance@2.5-flash';
const KLING_IMAGE = 'kwaivgi/kling-image-v4.0/text-to-image';
const ATLAS_KLING_FLASH = ['text', 'image', 'reference'].map((mode) => `kwaivgi/kling-v4.0-flash/${mode}-to-video`);

function textOf(cell: ReturnType<typeof providerVideoSpecs>[number]): string | string[] | boolean {
  if (cell.kind === 'text') return cell.value;
  if (cell.kind === 'shapes') return cell.ratios;
  return cell.on;
}

afterEach(() => vi.restoreAllMocks());

describe('the four models in the catalog', () => {
  it('lists every vendor id verbatim, once', () => {
    const runware = PROVIDER_MODELS.runware.map((model) => model.id);
    const atlas = PROVIDER_MODELS.atlas.map((model) => model.id);
    for (const id of [HEYGEN_VIDEO_MODEL, RUNWARE_FLASH, KLING_4_FLASH_MODEL]) expect(runware.filter((entry) => entry === id)).toHaveLength(1);
    for (const id of [...ATLAS_SEEDANCE_25_FLASH_MODELS, ...ATLAS_KLING_FLASH, KLING_IMAGE]) expect(atlas.filter((entry) => entry === id)).toHaveLength(1);
    expect(HEYGEN_VIDEO_MODEL).toBe('heygen:video@1.0');
    // Kling Image 4.0 is on Atlas only; Runware's copy is the documented alternative.
    expect(runware.some((id) => id.includes('kling-image'))).toBe(false);
    // Edit and image-set endpoints are not offered.
    expect(atlas).not.toContain('kwaivgi/kling-v4.0-flash/video-edit');
    expect(atlas).not.toContain('kwaivgi/kling-image-v4.0/image-set');
  });

  it('keeps file codes unique within each provider', () => {
    for (const provider of ['runware', 'atlas'] as const) {
      const codes = PROVIDER_MODELS[provider].map((model) => model.fileCode);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('puts Atlas Kling 4.0 Flash right after the Kling 4.0 block', () => {
    const ids = PROVIDER_MODELS.atlas.map((model) => model.id);
    expect(ids.indexOf(ATLAS_KLING_FLASH[0])).toBe(ids.indexOf('kwaivgi/kling-v4.0/video-edit') + 1);
    expect(ids.indexOf(ATLAS_SEEDANCE_25_FLASH_MODELS[0])).toBe(ids.indexOf('bytedance/seedance-2.5/reference-to-video') + 1);
  });

  it('describes HeyGen with its modes, sizes and per-mode length', () => {
    const model = findModel('runware', HEYGEN_VIDEO_MODEL)!;
    expect(model).toMatchObject({
      kind: 'video', modes: ['text', 'image', 'reference'],
      duration: { type: 'range', min: 5, max: 30, default: 5 },
      maxSecondsByMode: { reference: 15 }, tierWithInputs: 'media',
    });
    expect(model.sizes).toHaveLength(16);
    expect(model.videoInputs?.reference).toMatchObject({ field: 'referenceImages', maxImages: 9 });
    expect(model.referenceClips).toBeUndefined();
    expect(model.supportsAudio).toBeUndefined();
  });

  it('describes Runware Seedance 2.5 Flash without draft, and leaves 2.5 draft alone', () => {
    const flash = findModel('runware', RUNWARE_FLASH)!;
    expect(flash.modes).toEqual(['text', 'image', 'frames', 'reference', 'edit']);
    expect(flash.draftPreview).toBeUndefined();
    expect(flash.videoEdit?.draftPreview).toBeUndefined();
    expect(flash.sizes?.every((size) => /^(480p|720p) /.test(size.label))).toBe(true);
    expect(flash.sizes).toHaveLength(12);
    expect(flash.referenceClips).toMatchObject({ video: { max: 5 }, audio: { max: 5 } });
    expect(flash.videoInputs?.reference?.maxImages).toBe(10);
    const full = findModel('runware', 'bytedance:seedance@2.5')!;
    expect(full.draftPreview).toBe(true);
    expect(full.videoEdit?.draftPreview).toBe(true);
    expect(full.tierWithInputs).toBeUndefined();
    expect(full.rate).toEqual({ usdByResolution: { '480p': 0.102, '720p': 0.23, '1080p': 0.614 }, per: 'second' });
  });

  it('describes the Atlas entries with the limits their schemas publish', () => {
    for (const id of ATLAS_SEEDANCE_25_FLASH_MODELS) {
      const model = findModel('atlas', id)!;
      expect(model.sizes?.map((size) => size.preset)).toEqual(['480p', '720p']);
      expect(model.duration).toEqual({ type: 'range', min: 4, max: 30, default: 5 });
      expect(model.draftPreview).toBeUndefined();
    }
    for (const id of ATLAS_KLING_FLASH) {
      const model = findModel('atlas', id)!;
      expect(model.sizes).toEqual([{ label: '720p', preset: '720p' }]);
      expect(model.duration).toEqual({ type: 'range', min: 3, max: 20, default: 10 });
    }
    expect(findModel('atlas', ATLAS_KLING_FLASH[1])).toMatchObject({ modes: ['image'], aspectRatios: [], maxInputImages: 1 });
    expect(findModel('atlas', KLING_IMAGE)).toMatchObject({ kind: 'image', modes: ['text', 'image'], maxInputImages: 10 });
    expect(modelsFor('atlas', 'image').map((model) => model.id)).toContain(KLING_IMAGE);
  });
});

describe('list prices stored in the catalog', () => {
  it('stores HeyGen at list, double the sale', () => {
    const model = findModel('runware', HEYGEN_VIDEO_MODEL)!;
    expect(model.rate).toEqual({ usdByResolution: { '480p': 0.02, '768p': 0.036, '1080p': 0.10, '2K': 0.10 }, per: 'second' });
    expect(model.referenceRate).toEqual({
      usdByResolution: { '480p': 0.07, '768p': 0.10, '1080p': 0.18, '2K': 0.18 }, per: 'second',
      extraInputImageUsd: 0.04, includedInputImages: 2,
    });
    for (const [tier, usd] of Object.entries(HEYGEN_VIDEO_PROMOTION.rate.usdByResolution!)) {
      expect(usd * 2).toBeCloseTo(model.rate!.usdByResolution![tier], 10);
    }
    for (const [tier, usd] of Object.entries(HEYGEN_VIDEO_PROMOTION.referenceRate!.usdByResolution!)) {
      expect(usd * 2).toBeCloseTo(model.referenceRate!.usdByResolution![tier], 10);
    }
    expect(model.note).not.toMatch(/50% off/);
  });

  it('stores Runware Seedance 2.5 Flash at the published figures, with no sale', () => {
    const model = findModel('runware', RUNWARE_FLASH)!;
    expect(model.rate).toEqual({ usdByResolution: { '480p': 0.0678, '720p': 0.152 }, per: 'second' });
    expect(model.videoEdit?.rate).toEqual({ per: 'second', usdByResolution: { '480p': 0.0833, '720p': 0.187 } });
    expect(modelPromotionAt(RUNWARE_FLASH, HEYGEN_VIDEO_PROMOTION.startsAt)).toBeUndefined();
  });

  it('stores Atlas Kling 4.0 Flash at list with no promotion, because the discount has no end date', () => {
    for (const id of ATLAS_KLING_FLASH) {
      const model = findModel('atlas', id)!;
      expect(model.rate).toEqual({ per: 'second', usd: 0.12246 });
      expect(modelPromotionAt(id, Date.parse('2026-11-20T00:00:00Z'))).toBeUndefined();
      expect(withModelSale(model, Date.parse('2026-11-20T00:00:00Z'))).toBe(model);
      expect(resolveCatalogRate(model, 10, 1, { size: '720p' }).costUsd).toBeCloseTo(1.2246, 8);
    }
    // The quoted discount is 70% of list, kept for reference and never charged.
    expect(ATLAS_KLING_40_FLASH_QUOTED_USD).toBeCloseTo(0.12246 * 0.7, 8);
    expect(MODEL_PROMOTIONS.some((promotion) => promotion.modelIds.some((id) => id.includes('kling')))).toBe(false);
  });

  it('stores Kling Image 4.0 at list and prices the size and reference count sent', () => {
    const model = findModel('atlas', KLING_IMAGE)!;
    const price = (controls: Parameters<typeof resolveCatalogRate>[3], outputs = 1) => resolveCatalogRate(model, undefined, outputs, controls).costUsd;
    expect(price({ size: '2K', inputImages: 0 })).toBeCloseTo(0.063, 8);
    expect(price({ size: '4K', inputImages: 0 })).toBeCloseTo(0.094, 8);
    // Atlas's calculator: one reference at 2K is $0.066 list, three are $0.072.
    expect(price({ size: '2K', inputImages: 1 })).toBeCloseTo(0.066, 8);
    expect(price({ size: '2K', inputImages: 3 })).toBeCloseTo(0.072, 8);
    expect(price({ size: '4K', inputImages: 10 })).toBeCloseTo(0.124, 8);
    expect(price({ size: '8K', inputImages: 0 })).toBeNull();
    expect(price({ size: '2K' })).toBeNull();
    expect(KLING_IMAGE_40_QUOTED_USD['2k']).toBeCloseTo(0.063 * 0.9, 8);
    expect(textOf(providerImageSpecs(model)[0])).toBe('$0.063/img');
    expect(modelPromotionAt(KLING_IMAGE, Date.parse('2026-11-20T00:00:00Z'))).toBeUndefined();
  });
});

describe('HeyGen Video 1.0 sale', () => {
  const model = findModel('runware', HEYGEN_VIDEO_MODEL)!;
  const { startsAt, endsAt } = HEYGEN_VIDEO_PROMOTION;
  const cost = (at: number, seconds: number, controls: Parameters<typeof resolveCatalogRate>[3]) =>
    resolveCatalogRate(withModelSale(model, at), seconds, 1, controls).costUsd;

  it('ends at the instant the page publishes, 2026-11-30 23:00 UTC', () => {
    expect(endsAt).toBe(Date.parse('2026-11-30T23:00:00Z'));
    expect(modelPromotionAt(HEYGEN_VIDEO_MODEL, startsAt - 1)).toBeUndefined();
    expect(modelPromotionAt(HEYGEN_VIDEO_MODEL, startsAt)).toBe(HEYGEN_VIDEO_PROMOTION);
    expect(modelPromotionAt(HEYGEN_VIDEO_MODEL, endsAt - 1)).toBe(HEYGEN_VIDEO_PROMOTION);
    expect(modelPromotionAt(HEYGEN_VIDEO_MODEL, endsAt)).toBeUndefined();
  });

  it('returns the catalog object outside the window and one cached copy inside it', () => {
    expect(withModelSale(model, startsAt - 1)).toBe(model);
    expect(withModelSale(model, endsAt)).toBe(model);
    expect(withModelSale(model, startsAt)).not.toBe(model);
    expect(withModelSale(model, startsAt)).toBe(withModelSale(model, endsAt - 1));
    expect(withModelSale(undefined, startsAt)).toBeUndefined();
  });

  it('halves a text run during the sale and charges list at the boundary', () => {
    const controls = { inputMode: 'text', size: '768p · 16:9', inputImages: 0 };
    expect(cost(endsAt - 1, 10, controls)).toBeCloseTo(0.18, 8);
    expect(cost(endsAt, 10, controls)).toBeCloseTo(0.36, 8);
    expect(cost(endsAt - 1, 30, { ...controls, size: '2K · 9:16' })).toBeCloseTo(1.5, 8);
    expect(cost(endsAt, 30, { ...controls, size: '2K · 9:16' })).toBeCloseTo(3, 8);
    expect(cost(endsAt - 1, 5, { ...controls, inputMode: 'image', size: '480p · 1:1', inputImages: 1 })).toBeCloseTo(0.05, 8);
  });

  it('prices references at their own rate, with the first two images included', () => {
    const controls = { inputMode: 'reference', size: '768p · 16:9' };
    expect(cost(endsAt - 1, 10, { ...controls, inputImages: 2 })).toBeCloseTo(0.5, 8);
    expect(cost(endsAt - 1, 10, { ...controls, inputImages: 5 })).toBeCloseTo(0.5 + 3 * 0.02, 8);
    expect(cost(endsAt, 10, { ...controls, inputImages: 2 })).toBeCloseTo(1, 8);
    expect(cost(endsAt, 10, { ...controls, inputImages: 5 })).toBeCloseTo(1 + 3 * 0.04, 8);
    expect(cost(endsAt, 10, controls)).toBeNull();
  });

  it('shows the sale in the picker, the note and list_models only while it runs', () => {
    expect(providerVideoSpecs(withModelSale(model, startsAt)).map(textOf)).toEqual(['30s', '2K', expect.any(Array), '$0.01/s']);
    expect(providerVideoSpecs(withModelSale(model, endsAt)).map(textOf)[3]).toBe('$0.02/s');
    expect(providerVideoSpecs(withModelSale(model, startsAt), 'reference').map(textOf).filter((_, index) => index !== 2)).toEqual(['15s', '2K', '$0.035/s']);
    expect(providerVideoSpecs(withModelSale(model, endsAt), 'reference').map(textOf)[3]).toBe('$0.07/s');
    expect(withModelSale(model, startsAt).note).toMatch(/50% off through Nov 30/);
    expect(withModelSale(model, endsAt).note).not.toMatch(/50% off/);
    const listed = () => describeModels(['runware']).find((entry) => entry.modelId === HEYGEN_VIDEO_MODEL)?.price;
    vi.spyOn(Date, 'now').mockReturnValue(endsAt - 1);
    expect(listed()).toBe('$0.01 / s @ 480p · $0.018 @ 768p · $0.05 @ 1080p and 2K');
    vi.mocked(Date.now).mockReturnValue(endsAt);
    expect(listed()).toBe('$0.02 / s @ 480p · $0.036 @ 768p · $0.10 @ 1080p and 2K');
  });
});

describe('Atlas Seedance 2.5 Flash sale', () => {
  const { startsAt, endsAt } = ATLAS_SEEDANCE_25_FLASH_PROMOTION;

  it('ends at the instant Atlas publishes, 2026-11-30 15:59 UTC', () => {
    expect(new Date(endsAt).toISOString()).toBe('2026-11-30T15:59:00.000Z');
    for (const id of ATLAS_SEEDANCE_25_FLASH_MODELS) {
      expect(modelPromotionAt(id, startsAt - 1)).toBeUndefined();
      expect(modelPromotionAt(id, endsAt - 1)).toBe(ATLAS_SEEDANCE_25_FLASH_PROMOTION);
      expect(modelPromotionAt(id, endsAt)).toBeUndefined();
    }
    // The full Seedance 2.5 is a different id and has no dated offer.
    expect(modelPromotionAt('bytedance/seedance-2.5/text-to-video', endsAt - 1)).toBeUndefined();
  });

  it('is 35% under list, as the calculator quotes', () => {
    const list = findModel('atlas', ATLAS_SEEDANCE_25_FLASH_MODELS[0])!.rate!.usdByResolution!;
    const sale = ATLAS_SEEDANCE_25_FLASH_PROMOTION.rate.usdByResolution!;
    expect(sale['720p'] / list['720p']).toBeCloseTo(0.65, 2);
    expect(sale['480p'] / list['480p']).toBeCloseTo(0.65, 2);
  });

  it.each(ATLAS_SEEDANCE_25_FLASH_MODELS)('estimates %s on sale inside the window and at list after it', (id) => {
    const model = findModel('atlas', id)!;
    const cost = (at: number, size: string) => resolveCatalogRate(withModelSale(model, at), 10, 1, { size, inputImages: 0 }).costUsd;
    expect(cost(endsAt - 1, '720p')).toBeCloseTo(1.589, 8);
    expect(cost(endsAt, '720p')).toBeCloseTo(2.445, 8);
    expect(cost(endsAt - 1, '480p')).toBeCloseTo(0.734, 8);
    expect(cost(endsAt, '480p')).toBeCloseTo(1.13, 8);
    expect(cost(endsAt, '1080p')).toBeNull();
    expect(providerVideoSpecs(withModelSale(model, endsAt - 1)).map(textOf)[3]).toBe('$0.0734/s');
    expect(providerVideoSpecs(withModelSale(model, endsAt)).map(textOf)[3]).toBe('$0.113/s');
  });

  it('prices a saved account job from its submission time, not its finish time', () => {
    const request: CloudJobRequest = {
      provider: 'atlas', modelId: ATLAS_SEEDANCE_25_FLASH_MODELS[0], mediaType: 'video', inputMode: 'text',
      prompt: 'A lighthouse', values: { size: '720p', durationSeconds: 8 }, referenceIds: [],
    };
    const entry = (at: number, pricedAt?: number) => buildAccountSpendEntry({ jobId: 'job', request, result: { sources: [{}] }, at, ...(pricedAt === undefined ? {} : { pricedAt }) });
    expect(entry(endsAt + 60_000, endsAt - 1)?.costUsd).toBeCloseTo(0.1589 * 8, 8);
    expect(entry(endsAt + 60_000, endsAt)?.costUsd).toBeCloseTo(0.2445 * 8, 8);
    expect(entry(endsAt + 60_000)?.costUsd).toBeCloseTo(0.2445 * 8, 8);
  });
});

describe('withModelSale and the older Kling VIDEO 4.0 Flash sale', () => {
  it('still applies the Runware Kling window that closed on Nov 11', () => {
    const model = findModel('runware', KLING_4_FLASH_MODEL)!;
    expect(withModelSale(model, KLING_4_FLASH_PROMOTION.endsAt - 1).rate).toEqual({ per: 'second', usd: 0.0799 });
    expect(withModelSale(model, KLING_4_FLASH_PROMOTION.endsAt)).toBe(model);
  });

  it('gives no model two offers', () => {
    const ids = MODEL_PROMOTIONS.flatMap((promotion) => promotion.modelIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(KLING_4_FLASH_MODEL);
    for (const promotion of MODEL_PROMOTIONS) expect(promotion.endsAt).toBeGreaterThan(promotion.startsAt);
  });
});
