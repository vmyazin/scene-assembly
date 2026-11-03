import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudJobRequest } from '@/lib/account/contracts';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { estimateCloudJob } from '@/lib/spend/estimate';
import { RUNWARE_P_VIDEO_EDIT_PROMOTION } from '@/lib/spend/rates';

const during = Date.parse('2026-10-01T12:00:00Z');
const after = RUNWARE_P_VIDEO_EDIT_PROMOTION.endsAt;
const baseRequest: CloudJobRequest = {
  provider: 'runware', modelId: 'prunaai:p-video@edit', mediaType: 'video', inputMode: 'edit',
  prompt: 'Transform the forest into winter', values: { sourceDurationSeconds: 5, draft: false }, referenceIds: [],
};

afterEach(() => vi.restoreAllMocks());

describe('Runware P-Video-Edit promotion', () => {
  it('uses the verified standard sale rate during the promo period', () => {
    const entry = buildAccountSpendEntry({
      jobId: 'promo-std', request: baseRequest, result: { sources: [{}] }, at: during,
    });
    expect(entry).toMatchObject({ at: during, confidence: 'estimated', source: 'catalog-rate' });
    expect(entry?.costUsd).toBeCloseTo(0.0338 * 5);
  });

  it('uses the verified draft sale rate during the promo period', () => {
    const entry = buildAccountSpendEntry({
      jobId: 'promo-draft',
      request: { ...baseRequest, values: { ...baseRequest.values, draft: true } },
      result: { sources: [{}] },
      at: during,
    });
    expect(entry).toMatchObject({ at: during, confidence: 'estimated', source: 'catalog-rate' });
    expect(entry?.costUsd).toBeCloseTo(0.0188 * 5);
  });

  it('expires the prices together, including in an already loaded process', () => {
    vi.spyOn(Date, 'now').mockReturnValue(during);
    expect(estimateCloudJob(baseRequest).costUsd).toBeCloseTo(0.0338 * 5);
    expect(estimateCloudJob({ ...baseRequest, values: { ...baseRequest.values, draft: true } }).costUsd).toBeCloseTo(0.0188 * 5);

    vi.mocked(Date.now).mockReturnValue(after);
    expect(estimateCloudJob(baseRequest).costUsd).toBeCloseTo(0.045 * 5);
    expect(estimateCloudJob({ ...baseRequest, values: { ...baseRequest.values, draft: true } }).costUsd).toBeCloseTo(0.025 * 5);
  });

  it('does not invent promotional pricing before the verified window', () => {
    const entry = buildAccountSpendEntry({
      jobId: 'before',
      request: baseRequest,
      result: { sources: [{}] },
      at: RUNWARE_P_VIDEO_EDIT_PROMOTION.startsAt - 1,
    });
    expect(entry?.costUsd).toBeCloseTo(0.045 * 5);
  });

  it('uses standard and draft sale rates for current run estimates', () => {
    vi.spyOn(Date, 'now').mockReturnValue(during);
    expect(estimateCloudJob(baseRequest).costUsd).toBeCloseTo(0.0338 * 5);
    expect(estimateCloudJob({ ...baseRequest, values: { ...baseRequest.values, draft: true } }).costUsd).toBeCloseTo(0.0188 * 5);

    vi.mocked(Date.now).mockReturnValue(after);
    expect(estimateCloudJob(baseRequest).costUsd).toBeCloseTo(0.045 * 5);
    expect(estimateCloudJob({ ...baseRequest, values: { ...baseRequest.values, draft: true } }).costUsd).toBeCloseTo(0.025 * 5);
  });

  it('uses original job time when capture happens after expiry', () => {
    vi.spyOn(Date, 'now').mockReturnValue(after);
    const entry = buildAccountSpendEntry({
      jobId: 'promo-late', request: baseRequest, result: { sources: [{}] }, at: after, pricedAt: during,
    });
    expect(entry).toMatchObject({ at: after, confidence: 'estimated', source: 'catalog-rate' });
    expect(entry?.costUsd).toBeCloseTo(0.0338 * 5);
  });

  it('preserves provider-reported costs over catalog promotion rates', () => {
    const entry = buildAccountSpendEntry({
      jobId: 'reported', request: baseRequest, result: { sources: [{}], cost: 0.20 }, at: during,
    });
    expect(entry).toMatchObject({ at: during, confidence: 'exact', source: 'response' });
    expect(entry?.costUsd).toBe(0.20);
  });
});
