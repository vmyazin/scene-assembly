// tests/spend/kling-4-flash-promotion.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudJobRequest } from '@/lib/account/contracts';
import { describeModels } from '@/lib/account/model-schema';
import { providerVideoSpecs } from '@/lib/models/listbox-specs';
import { findModel } from '@/lib/providers/catalog';
import {
  KLING_4_FLASH_MODEL,
  KLING_4_FLASH_PROMOTION,
  kling4FlashPromotionActive,
  withKling4FlashSale,
} from '@/lib/providers/kling-4-flash-promo';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { resolveCatalogRate } from '@/lib/spend/resolve';

const during = Date.parse('2026-11-10T23:59:59.999Z');
const after = KLING_4_FLASH_PROMOTION.endsAt;
const before = KLING_4_FLASH_PROMOTION.startsAt - 1;

function textOf(cell: ReturnType<typeof providerVideoSpecs>[number]): string | string[] | boolean {
  if (cell.kind === 'text') return cell.value;
  if (cell.kind === 'shapes') return cell.ratios;
  return cell.on;
}

afterEach(() => vi.restoreAllMocks());

describe('Kling VIDEO 4.0 Flash catalog entry', () => {
  const model = findModel('runware', KLING_4_FLASH_MODEL)!;

  it('is listed with the vendor id, modes, 720p sizes, and 3–20s range', () => {
    expect(model).toMatchObject({
      id: 'klingai:kling-video@4.0-flash',
      kind: 'video',
      modes: ['text', 'image', 'reference', 'edit'],
      duration: { type: 'range', min: 3, max: 20, default: 10 },
    });
    expect(model.sizes?.map((size) => [size.width, size.height])).toEqual([
      [1280, 720], [720, 1280], [960, 960], [1464, 628],
    ]);
    expect(model.videoInputs?.image).toMatchObject({ field: 'frameImages', maxImages: 1 });
    expect(model.videoInputs?.reference).toMatchObject({ field: 'referenceImages', maxImages: 10 });
    expect(model.referenceClips).toBeUndefined();
  });

  it('stores list prices for both the no-video and video-input rates', () => {
    expect(model.rate).toEqual({ per: 'second', usd: 0.094 });
    expect(model.price).toBe('$0.094 / s');
    expect(model.videoEdit?.rate).toEqual({ per: 'second', usd: 0.126 });
  });
});

describe('Kling VIDEO 4.0 Flash promotion', () => {
  const model = findModel('runware', KLING_4_FLASH_MODEL)!;

  it('is open only inside the window, and only for this model', () => {
    expect(kling4FlashPromotionActive(KLING_4_FLASH_MODEL, before)).toBe(false);
    expect(kling4FlashPromotionActive(KLING_4_FLASH_MODEL, during)).toBe(true);
    expect(kling4FlashPromotionActive(KLING_4_FLASH_MODEL, after)).toBe(false);
    expect(kling4FlashPromotionActive('klingai:kling-video@o3-4k', during)).toBe(false);
  });

  it('returns the catalog object outside the window and for every other model', () => {
    const other = findModel('runware', 'klingai:kling-video@o3-4k')!;
    expect(withKling4FlashSale(model, before)).toBe(model);
    expect(withKling4FlashSale(model, after)).toBe(model);
    expect(withKling4FlashSale(other, during)).toBe(other);
    expect(withKling4FlashSale(undefined, during)).toBeUndefined();
  });

  it('returns one stable copy during the sale, leaving the catalog on list price', () => {
    expect(withKling4FlashSale(model, during)).toBe(withKling4FlashSale(model, during - 1000));
    expect(withKling4FlashSale(model, during)).not.toBe(model);
    expect(model.rate).toEqual({ per: 'second', usd: 0.094 });
  });

  it.each([
    ['generation', undefined, 0.0799, 0.094],
    ['edit', 'edit', 0.107, 0.126],
  ] as const)('prices %s at the sale rate until the cutoff, then list', (_label, inputMode, sale, list) => {
    const at = (time: number) => resolveCatalogRate(withKling4FlashSale(model, time), 5, 1, { inputMode }).costUsd;
    expect(at(during)).toBeCloseTo(sale * 5);
    expect(at(after)).toBeCloseTo(list * 5);
    expect(at(before)).toBeCloseTo(list * 5);
  });

  it('expires the From sticker and sale note together in an already loaded process', () => {
    vi.spyOn(Date, 'now').mockReturnValue(after - 1);
    expect(providerVideoSpecs(withKling4FlashSale(model)).map(textOf)[3]).toBe('$0.0799/s');
    expect(providerVideoSpecs(withKling4FlashSale(model), 'edit').map(textOf)[3]).toBe('$0.107/s');
    expect(withKling4FlashSale(model).note).toMatch(/15% off through Nov 10/);
    expect(withKling4FlashSale(model).videoEdit?.note).toMatch(/15% off through Nov 10/);

    vi.mocked(Date.now).mockReturnValue(after);
    expect(providerVideoSpecs(withKling4FlashSale(model)).map(textOf)[3]).toBe('$0.094/s');
    expect(providerVideoSpecs(withKling4FlashSale(model), 'edit').map(textOf)[3]).toBe('$0.126/s');
    expect(withKling4FlashSale(model).note).not.toMatch(/15% off/);
    expect(withKling4FlashSale(model).videoEdit?.note).not.toMatch(/15% off/);
  });

  it('shows agents the price in force when they ask', () => {
    const listed = () => describeModels(['runware']).find((entry) => entry.modelId === KLING_4_FLASH_MODEL)?.price;
    vi.spyOn(Date, 'now').mockReturnValue(during);
    expect(listed()).toBe('$0.0799 / s');
    vi.mocked(Date.now).mockReturnValue(after);
    expect(listed()).toBe('$0.094 / s');
  });

  it('prices a saved job from its submission time, not its finish time', () => {
    const request: CloudJobRequest = {
      provider: 'runware', modelId: KLING_4_FLASH_MODEL, mediaType: 'video', inputMode: 'edit',
      prompt: 'Change the sky in <<<video_1>>>', values: { sourceDurationSeconds: 5 }, referenceIds: [],
    };
    const entry = (pricedAt: number) => buildAccountSpendEntry({ jobId: 'missing-cost', request, result: { sources: [{}] }, at: after + 1000, pricedAt });
    expect(entry(during)?.costUsd).toBeCloseTo(0.107 * 5);
    expect(entry(after)?.costUsd).toBeCloseTo(0.126 * 5);
    // Runware's reported cost still wins over any catalog figure.
    expect(buildAccountSpendEntry({ jobId: 'exact', request, result: { sources: [{}], cost: 0.5 }, at: after, pricedAt: during })?.costUsd).toBe(0.5);
  });
});
