// tests/spend/promo-flip.test.tsx
/**
 * Both dated sales that close on 2026-11-30 return to list on their own.
 *
 * Every figure here is asked for through the clock, never through an `at`
 * argument: the modules are imported once, during the sale, the way a Worker
 * or an open tab loads them, and then the clock moves past the end. Anything
 * that had read a sale rate at import would still answer with it.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudJobRequest } from '@/lib/account/contracts';
import { describeModels } from '@/lib/account/model-schema';
import { providerVideoSpecs } from '@/lib/models/listbox-specs';
import { DEFAULT_MODELS, findModel } from '@/lib/providers/catalog';
import { KLING_4_FLASH_PROMOTION } from '@/lib/providers/kling-4-flash-promo';
import {
  ATLAS_SEEDANCE_25_FLASH_MODELS,
  ATLAS_SEEDANCE_25_FLASH_PROMOTION,
  HEYGEN_VIDEO_MODEL,
  HEYGEN_VIDEO_PROMOTION,
  MODEL_PROMOTIONS,
  nextPromotionBoundary,
  withModelSale,
} from '@/lib/providers/model-promotions';
import { useSaleClock } from '@/lib/providers/use-sale-clock';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { captureProviderJob } from '@/lib/spend/capture';
import { estimateCloudJob } from '@/lib/spend/estimate';
import { resolveCatalogRate } from '@/lib/spend/resolve';
import type { ProviderJob } from '@/store/useProviderJobsStore';
import { useSpendStore } from '@/store/useSpendStore';

const HEYGEN_END = Date.parse('2026-11-30T23:00:00Z');
const ATLAS_END = Date.parse('2026-11-30T15:59:00Z');

const priceCell = (cells: ReturnType<typeof providerVideoSpecs>) => {
  const cell = cells[3];
  return cell.kind === 'text' ? cell.value : null;
};

beforeEach(() => {
  vi.useFakeTimers();
  useSpendStore.setState({ entries: [] });
});
afterEach(() => vi.useRealTimers());

describe('the published end instants', () => {
  it('ends HeyGen where Runware’s page removes the notice, and Atlas where its countdown stops', () => {
    expect(HEYGEN_VIDEO_PROMOTION.endsAt).toBe(HEYGEN_END);
    expect(ATLAS_SEEDANCE_25_FLASH_PROMOTION.endsAt).toBe(ATLAS_END);
    expect(ATLAS_SEEDANCE_25_FLASH_PROMOTION.endsAt).toBe(1_796_054_340_000);
    for (const promotion of MODEL_PROMOTIONS) {
      // Nothing is open-ended, and both close before December.
      expect(promotion.endsAt).toBeLessThan(Date.parse('2026-12-01T00:00:00Z'));
      expect(promotion.endsAt).toBeGreaterThan(promotion.startsAt);
    }
  });

  it('chose no default because of a sale price', () => {
    const onSale = MODEL_PROMOTIONS.flatMap((promotion) => [...promotion.modelIds]);
    for (const defaults of Object.values(DEFAULT_MODELS)) {
      expect(onSale).not.toContain(defaults.video);
      expect(onSale).not.toContain(defaults.image);
    }
  });
});

describe('HeyGen Video 1.0 across the end of its sale', () => {
  const model = findModel('runware', HEYGEN_VIDEO_MODEL)!;
  const estimate = (inputMode: string, inputImages: number) =>
    resolveCatalogRate(withModelSale(model), 10, 1, { inputMode, size: '768p · 16:9', inputImages }).costUsd;
  const listed = () => describeModels(['runware']).find((entry) => entry.modelId === HEYGEN_VIDEO_MODEL)!;

  it('estimates at the sale rate one millisecond before the end and at list from the end on', () => {
    vi.setSystemTime(HEYGEN_END - 1);
    expect(estimate('text', 0)).toBeCloseTo(0.18, 8);
    expect(estimate('reference', 4)).toBeCloseTo(0.5 + 2 * 0.02, 8);
    vi.setSystemTime(HEYGEN_END);
    expect(estimate('text', 0)).toBeCloseTo(0.36, 8);
    expect(estimate('reference', 4)).toBeCloseTo(1 + 2 * 0.04, 8);
    vi.setSystemTime(Date.parse('2026-12-01T00:00:00Z'));
    expect(estimate('text', 0)).toBeCloseTo(0.36, 8);
    vi.setSystemTime(Date.parse('2027-01-15T12:00:00Z'));
    expect(estimate('text', 0)).toBeCloseTo(0.36, 8);
  });

  it('shows the sale in the picker, the price and the note until the end, then list', () => {
    vi.setSystemTime(HEYGEN_END - 1);
    expect(priceCell(providerVideoSpecs(withModelSale(model)))).toBe('$0.01/s');
    expect(priceCell(providerVideoSpecs(withModelSale(model), 'reference'))).toBe('$0.035/s');
    expect(withModelSale(model).price).toBe('$0.01 / s @ 480p · $0.018 @ 768p · $0.05 @ 1080p and 2K');
    expect(withModelSale(model).note).toMatch(/50% off through Nov 30/);
    expect(listed().price).toBe('$0.01 / s @ 480p · $0.018 @ 768p · $0.05 @ 1080p and 2K');
    expect(listed().note).toMatch(/50% off/);

    vi.setSystemTime(HEYGEN_END);
    expect(withModelSale(model)).toBe(model);
    expect(priceCell(providerVideoSpecs(withModelSale(model)))).toBe('$0.02/s');
    expect(priceCell(providerVideoSpecs(withModelSale(model), 'reference'))).toBe('$0.07/s');
    expect(withModelSale(model).price).toBe('$0.02 / s @ 480p · $0.036 @ 768p · $0.10 @ 1080p and 2K');
    expect(withModelSale(model).note ?? '').not.toMatch(/50% off|Nov 30/);
    expect(listed().price).toBe('$0.02 / s @ 480p · $0.036 @ 768p · $0.10 @ 1080p and 2K');
    expect(listed().note ?? '').not.toMatch(/50% off|Nov 30/);
  });

  it('files a finished job at the cost Runware reports, on either side of the end', () => {
    // Runware returns the charge, so the ledger never reads the sale table for HeyGen.
    const job = (createdAt: number): ProviderJob => ({
      id: `job-${createdAt}`, provider: 'runware', modelId: HEYGEN_VIDEO_MODEL, inputMode: 'text', prompt: 'A presenter',
      controlValues: { duration: 10, size: '768p · 16:9' }, createdAt,
    } as unknown as ProviderJob);
    vi.setSystemTime(HEYGEN_END + 60_000);
    captureProviderJob('runware', job(HEYGEN_END - 1), { taskId: 't', state: 'success', urls: ['https://x/y.mp4'], cost: 0.18 });
    captureProviderJob('runware', job(HEYGEN_END), { taskId: 't', state: 'success', urls: ['https://x/y.mp4'], cost: 0.36 });
    expect(useSpendStore.getState().entries.map((entry) => [entry.costUsd, entry.confidence]).sort()).toEqual([[0.18, 'exact'], [0.36, 'exact']]);
  });
});

describe('Atlas Seedance 2.5 Flash across the end of its sale', () => {
  it.each(ATLAS_SEEDANCE_25_FLASH_MODELS)('estimates and labels %s on sale until 15:59 UTC, then at list', (id) => {
    const model = findModel('atlas', id)!;
    const estimate = (size: string) => resolveCatalogRate(withModelSale(model), 10, 1, { size, inputImages: 0 }).costUsd;
    const listed = () => describeModels(['atlas']).find((entry) => entry.modelId === id)!;

    vi.setSystemTime(ATLAS_END - 1);
    expect(estimate('720p')).toBeCloseTo(1.589, 8);
    expect(estimate('480p')).toBeCloseTo(0.734, 8);
    expect(priceCell(providerVideoSpecs(withModelSale(model)))).toBe('$0.0734/s');
    expect(listed().price).toBe('$0.0734 / s @ 480p · $0.1589 @ 720p');
    expect(listed().note).toMatch(/35% off through Nov 30/);

    vi.setSystemTime(ATLAS_END);
    expect(withModelSale(model)).toBe(model);
    expect(estimate('720p')).toBeCloseTo(2.445, 8);
    expect(estimate('480p')).toBeCloseTo(1.13, 8);
    expect(priceCell(providerVideoSpecs(withModelSale(model)))).toBe('$0.113/s');
    expect(listed().price).toBe(model.price);
    expect(listed().price).toMatch(/\$0\.113 .*\$0\.2445/);
    expect(listed().note ?? '').not.toMatch(/35% off/);
  });

  const request: CloudJobRequest = {
    provider: 'atlas', modelId: ATLAS_SEEDANCE_25_FLASH_MODELS[0], mediaType: 'video', inputMode: 'text',
    prompt: 'A lighthouse', values: { size: '720p', durationSeconds: 8 }, referenceIds: [],
  };

  it('charges an agent’s budget the sale rate until the end and list after it', () => {
    vi.setSystemTime(ATLAS_END - 1);
    expect(estimateCloudJob(request)).toMatchObject({ confidence: 'estimated' });
    expect(estimateCloudJob(request).costUsd).toBeCloseTo(0.1589 * 8, 8);
    vi.setSystemTime(ATLAS_END);
    expect(estimateCloudJob(request).costUsd).toBeCloseTo(0.2445 * 8, 8);
  });

  it('files the account ledger and the browser ledger from the submission time', () => {
    const entry = (pricedAt: number) => buildAccountSpendEntry({ jobId: 'job', request, result: { sources: [{}] }, at: ATLAS_END + 3_600_000, pricedAt })?.costUsd;
    expect(entry(ATLAS_END - 1)).toBeCloseTo(0.1589 * 8, 8);
    expect(entry(ATLAS_END)).toBeCloseTo(0.2445 * 8, 8);

    vi.setSystemTime(ATLAS_END + 3_600_000);
    const job = (createdAt: number): ProviderJob => ({
      id: `job-${createdAt}`, provider: 'atlas', modelId: request.modelId, inputMode: 'text', prompt: 'A lighthouse',
      controlValues: { duration: 8, size: '720p' }, createdAt,
    } as unknown as ProviderJob);
    captureProviderJob('atlas', job(ATLAS_END - 1), { taskId: 't', state: 'success', urls: ['https://x/y.mp4'] });
    captureProviderJob('atlas', job(ATLAS_END), { taskId: 't', state: 'success', urls: ['https://x/y.mp4'] });
    const costs = useSpendStore.getState().entries.map((item) => item.costUsd!).sort();
    expect(costs[0]).toBeCloseTo(0.1589 * 8, 8);
    expect(costs[1]).toBeCloseTo(0.2445 * 8, 8);
  });
});

describe('a screen left open across the end of a sale', () => {
  it('names the next instant a price changes, then nothing once every window is closed', () => {
    expect(nextPromotionBoundary(Date.parse('2026-11-23T00:00:00Z'))).toBe(ATLAS_END);
    expect(nextPromotionBoundary(ATLAS_END - 1)).toBe(ATLAS_END);
    expect(nextPromotionBoundary(ATLAS_END)).toBe(HEYGEN_END);
    expect(nextPromotionBoundary(HEYGEN_END)).toBeUndefined();
    expect(nextPromotionBoundary(KLING_4_FLASH_PROMOTION.startsAt - 1)).toBe(KLING_4_FLASH_PROMOTION.startsAt);
    expect(nextPromotionBoundary(Date.parse('2026-11-10T12:00:00Z'))).toBe(KLING_4_FLASH_PROMOTION.endsAt);
  });

  it('renders again at each end, so the price on screen flips without a press', () => {
    const heygen = findModel('runware', HEYGEN_VIDEO_MODEL)!;
    const atlas = findModel('atlas', ATLAS_SEEDANCE_25_FLASH_MODELS[0])!;
    vi.setSystemTime(ATLAS_END - 60_000);
    const { result, unmount } = renderHook(() => {
      useSaleClock();
      return {
        heygen: priceCell(providerVideoSpecs(withModelSale(heygen))),
        atlas: priceCell(providerVideoSpecs(withModelSale(atlas))),
      };
    });
    expect(result.current).toEqual({ heygen: '$0.01/s', atlas: '$0.0734/s' });

    act(() => { vi.advanceTimersByTime(59_999); });
    expect(result.current).toEqual({ heygen: '$0.01/s', atlas: '$0.0734/s' });
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual({ heygen: '$0.01/s', atlas: '$0.113/s' });

    // The timer re-arms for the next boundary: HeyGen, seven hours later.
    act(() => { vi.advanceTimersByTime(HEYGEN_END - ATLAS_END - 1); });
    expect(result.current.heygen).toBe('$0.01/s');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual({ heygen: '$0.02/s', atlas: '$0.113/s' });

    // Nothing is left to wait for.
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('arms no timer once the last sale is over', () => {
    vi.setSystemTime(HEYGEN_END + 1);
    const { unmount } = renderHook(() => useSaleClock());
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });
});
