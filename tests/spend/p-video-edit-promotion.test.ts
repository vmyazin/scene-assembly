// tests/spend/p-video-edit-promotion.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findModel } from '@/lib/providers/catalog';
import {
  pVideoEditPromotionNote,
  pVideoEditRates,
  P_VIDEO_EDIT_PROMOTION,
} from '@/lib/providers/p-video-edit-promo';
import { providerVideoSpecs } from '@/lib/models/listbox-specs';
import { resolveCatalogRate } from '@/lib/spend/resolve';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import type { CloudJobRequest } from '@/lib/account/contracts';

const modelId = 'prunaai:p-video@edit';
const during = Date.parse('2026-11-03T23:59:59.999Z');
const after = P_VIDEO_EDIT_PROMOTION.endsAt;
const before = P_VIDEO_EDIT_PROMOTION.startsAt - 1;

function textOf(cell: ReturnType<typeof providerVideoSpecs>[number]): string | string[] | boolean {
  if (cell.kind === 'text') return cell.value;
  if (cell.kind === 'shapes') return cell.ratios;
  return cell.on;
}

afterEach(() => vi.restoreAllMocks());

describe('P-Video-Edit promotion', () => {
  const model = findModel('runware', modelId)!;

  it('keeps list prices on the catalog and applies the sale only inside the window', () => {
    expect(model.videoEdit?.rate).toMatchObject({ per: 'second', usd: 0.045 });
    expect(model.videoEdit?.draftRate).toMatchObject({ per: 'second', usd: 0.025 });
    expect(pVideoEditRates(modelId, before)).toBeNull();
    expect(pVideoEditRates(modelId, during)).toEqual({
      rate: P_VIDEO_EDIT_PROMOTION.rate,
      draftRate: P_VIDEO_EDIT_PROMOTION.draftRate,
    });
    expect(pVideoEditRates(modelId, after)).toBeNull();
    expect(pVideoEditRates('bytedance:seedance@2.5', during)).toBeNull();
  });

  it.each([
    [false, 0.0338, 0.045],
    [true, 0.0188, 0.025],
  ] as const)('prices draft=%s at the sale rate before the cutoff and the list rate after', (draft, sale, list) => {
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit', draft, pricedAt: during }).costUsd).toBeCloseTo(sale * 5);
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit', draft, pricedAt: after }).costUsd).toBeCloseTo(list * 5);
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit', draft, pricedAt: before }).costUsd).toBeCloseTo(list * 5);
  });

  it('expires the From sticker and the sale sentence together, including in an already loaded process', () => {
    vi.spyOn(Date, 'now').mockReturnValue(after - 1);
    expect(providerVideoSpecs(model, 'edit').map(textOf)).toEqual(['15s', '848px', 'source', '$0.0188/s']);
    expect(pVideoEditPromotionNote(modelId)).toBe('25% off through Nov 3.');
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit' }).costUsd).toBeCloseTo(0.169);
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit', draft: true }).costUsd).toBeCloseTo(0.094);

    vi.mocked(Date.now).mockReturnValue(after);
    expect(providerVideoSpecs(model, 'edit').map(textOf)).toEqual(['15s', '848px', 'source', '$0.025/s']);
    expect(pVideoEditPromotionNote(modelId)).toBeNull();
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit' }).costUsd).toBeCloseTo(0.225);
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit', draft: true }).costUsd).toBeCloseTo(0.125);
  });

  it('keeps a reported Runware cost and prices a late catalog read from the submission time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(after);
    const request: CloudJobRequest = {
      provider: 'runware', modelId, mediaType: 'video', inputMode: 'edit',
      prompt: 'Change the sky', values: { sourceDurationSeconds: 5, draft: true }, referenceIds: [],
    };
    // Runware's own cost stays exact. The catalog estimate, used for the
    // button and for a provider that prices from the table, follows pricedAt
    // rather than the clock at filing time.
    expect(buildAccountSpendEntry({
      jobId: 'exact', request, result: { sources: [{}], cost: 0.094 }, at: after, pricedAt: during,
    })?.costUsd).toBe(0.094);
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit', draft: true, pricedAt: during }).costUsd).toBeCloseTo(0.094);
    expect(resolveCatalogRate(model, 5, 1, { inputMode: 'edit', draft: true }).costUsd).toBeCloseTo(0.125);
  });
});
