import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudJobRequest } from '@/lib/account/contracts';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { estimateCloudJob } from '@/lib/spend/estimate';
import { falPublishedCost, falPromotionNote, falRateLabel, FAL_H3_TURBO_PROMOTION } from '@/lib/spend/rates';
import { falRunCost, falRunPromotion } from '@/lib/fal/run-cost';

const endpoint = 'minimax/h3-max-turbo/image-to-video';
const during = Date.parse('2026-10-26T12:00:00Z');
const after = FAL_H3_TURBO_PROMOTION.endsAt;
const request: CloudJobRequest = {
  provider: 'fal', modelId: 'h3-max-turbo', mediaType: 'video', inputMode: 'text',
  prompt: 'An autumn forest', values: { duration: 5, resolution: '768P' }, referenceIds: [],
};

afterEach(() => vi.restoreAllMocks());

describe('fal H3 Max Turbo promotion', () => {
  it.each([['480P', 0.01625], ['768P', 0.026], ['1080P', 0.052]] as const)(
    'uses the verified %s sale rate with the same output overrun', (resolution, rate) => {
      expect(falPublishedCost(endpoint, { resolution, durationSeconds: 5, pricedAt: during })).toEqual({
        costUsd: expect.closeTo(rate * 5.7, 8), unit: 'second', quantity: 5.7,
      });
    }
  );

  it('expires the prices and copy together, including in an already loaded process', () => {
    vi.spyOn(Date, 'now').mockReturnValue(after - 1);
    expect(falRateLabel(endpoint)).toBe('$0.01625–0.052 / s');
    expect(falPromotionNote(endpoint)).toBe('35% off through Oct 31.');
    expect(falRunCost('h3-max-turbo', 'video', 'text', '768P', undefined, 5)?.costUsd).toBeCloseTo(0.026 * 5.7);

    vi.mocked(Date.now).mockReturnValue(after);
    expect(falRateLabel(endpoint)).toBe('$0.025–0.08 / s');
    expect(falPromotionNote(endpoint)).toBeNull();
    expect(falRunPromotion('h3-max-turbo', 'video', 'text')).toBeNull();
    expect(falRunCost('h3-max-turbo', 'video', 'text', '768P', undefined, 5)?.costUsd).toBeCloseTo(0.04 * 5.7);
  });

  it('does not invent promotional pricing before the verified window or for H3 edits', () => {
    expect(falRateLabel(endpoint, FAL_H3_TURBO_PROMOTION.startsAt - 1)).toBe('$0.025–0.08 / s');
    expect(falPromotionNote('minimax/h3-max/recast', during)).toBeNull();
    expect(falPublishedCost('minimax/h3-max/recast', { resolution: '768P', durationSeconds: 5, pricedAt: during })?.costUsd).toBe(1.5);
    expect(falPublishedCost('minimax/h3-max/relight', { resolution: '768P', durationSeconds: 5, pricedAt: during })?.costUsd).toBe(0.4);
  });

  it.each(['text', 'image', 'frames'] as const)('uses the sale for %s estimates and current cloud reservations', (mode) => {
    vi.spyOn(Date, 'now').mockReturnValue(during);
    expect(falRunCost('h3-max-turbo', 'video', mode, '768P', undefined, 5)?.costUsd).toBeCloseTo(0.026 * 5.7);
    expect(estimateCloudJob({ ...request, inputMode: mode }).costUsd).toBeCloseTo(0.026 * 5.7);
    vi.mocked(Date.now).mockReturnValue(after);
    expect(estimateCloudJob({ ...request, inputMode: mode }).costUsd).toBeCloseTo(0.04 * 5.7);
  });

  it('uses original job time when capture happens after expiry', () => {
    vi.spyOn(Date, 'now').mockReturnValue(after);
    const entry = buildAccountSpendEntry({
      jobId: 'promo', request, result: { sources: [{}] }, at: after, pricedAt: during,
    });
    expect(entry).toMatchObject({ at: after, confidence: 'estimated', source: 'catalog-rate' });
    expect(entry?.costUsd).toBeCloseTo(0.026 * 5.7);
  });
});
