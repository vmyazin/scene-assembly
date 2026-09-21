// tests/spend/resolve.test.ts
import { describe, expect, it } from 'vitest';

import type { KieJob } from '@/lib/kie/types';
import type { ProviderModel } from '@/lib/providers/types';
import {
  kieSharers,
  resolveCatalogRate,
  resolveFalEstimate,
  resolveFalRun,
  resolveFree,
  resolveGemini,
  resolveGeminiVideo,
  resolveHelper,
  resolveKieDelta,
  resolveRunware,
} from '@/lib/spend/resolve';

describe('resolveGemini', () => {
  it('is exact when the response carried usage', () => {
    expect(resolveGemini({ usage: { promptTokens: 560, outputTokens: 1120 }, resolution: '4K', inputImages: 3 })).toEqual({
      costUsd: expect.closeTo(0.13552, 6),
      confidence: 'exact',
      source: 'usage-metadata',
      quantity: { unit: 'token', value: 1680 },
    });
  });
  it('falls back to the resolution estimate', () => {
    expect(resolveGemini({ usage: null, resolution: '4K', inputImages: 1 })).toEqual({
      costUsd: expect.closeTo(0.24112, 6),
      confidence: 'estimated',
      source: 'catalog-rate',
      quantity: { unit: 'image', value: 1 },
    });
  });
  it('prices the model that ran, not the one the engine used to be fixed to', () => {
    // The same request on all three: Lite is a quarter of Pro at 1K, and a
    // ledger that priced them alike would overstate a Lite run fourfold.
    const run = (modelId: string) =>
      resolveGemini({ usage: { promptTokens: 0, outputTokens: 1120 }, modelId, resolution: '1K', inputImages: 0 }).costUsd;
    expect(run('gemini-3-pro-image-preview')).toBeCloseTo(0.1344, 6);
    expect(run('gemini-3.1-flash-image')).toBeCloseTo(0.0672, 6);
    expect(run('gemini-3.1-flash-lite-image')).toBeCloseTo(0.0336, 6);
  });
  it('estimates a model without usage metadata from its own rate', () => {
    expect(resolveGemini({ usage: null, modelId: 'gemini-3.1-flash-image', resolution: '2K', inputImages: 0 })).toMatchObject({
      costUsd: expect.closeTo(0.1008, 6),
      confidence: 'estimated',
      source: 'catalog-rate',
    });
  });
});

describe('resolveGeminiVideo', () => {
  it('prices Veo 3.1 Lite from the published per-second table', () => {
    expect(
      resolveGeminiVideo({
        modelId: 'veo-3.1-lite-generate-preview',
        resolution: '720p',
        durationSeconds: 8,
      })
    ).toEqual({
      costUsd: 0.4,
      confidence: 'estimated',
      source: 'catalog-rate',
      quantity: { unit: 'second', value: 8 },
    });
    expect(
      resolveGeminiVideo({
        modelId: 'veo-3.1-lite-generate-preview',
        resolution: '1080p',
        durationSeconds: 8,
      }).costUsd
    ).toBeCloseTo(0.64, 6);
  });
});

describe('resolveRunware', () => {
  it('trusts the response cost', () => {
    expect(resolveRunware(0.0032)).toEqual({ costUsd: 0.0032, confidence: 'exact', source: 'response' });
  });
  it('is unknown without one', () => {
    expect(resolveRunware(undefined)).toMatchObject({ costUsd: null, confidence: 'unknown', source: 'response' });
  });
});

describe('resolveCatalogRate', () => {
  const image = { id: 'm', rate: { usd: 0.04, per: 'image' } } as ProviderModel;
  const video = { id: 'v', rate: { usd: 0.002, per: 'second' } } as ProviderModel;
  const metered = { id: 'x' } as ProviderModel;

  it('multiplies per-second rates by the duration', () => {
    expect(resolveCatalogRate(video, 5)).toEqual({
      costUsd: expect.closeTo(0.01, 6),
      confidence: 'estimated',
      source: 'catalog-rate',
      quantity: { unit: 'second', value: 5 },
    });
  });
  it('charges one unit for per-image rates', () => {
    expect(resolveCatalogRate(image)).toMatchObject({ costUsd: 0.04, quantity: { unit: 'image', value: 1 } });
  });
  it('is unknown for a metered model or a missing duration', () => {
    expect(resolveCatalogRate(metered)).toMatchObject({ costUsd: null, confidence: 'unknown' });
    expect(resolveCatalogRate(video)).toMatchObject({ costUsd: null, confidence: 'unknown' });
    expect(resolveCatalogRate(undefined)).toMatchObject({ costUsd: null, confidence: 'unknown' });
  });
});

describe('resolveFree', () => {
  it('records a free run as exactly nothing', () => {
    expect(resolveFree()).toEqual({ costUsd: 0, confidence: 'exact', source: 'free', quantity: { unit: 'image', value: 1 } });
  });
});

describe('resolveFalEstimate', () => {
  it('uses the vendor estimate and unit', () => {
    expect(resolveFalEstimate({ costUsd: 0.4, unit: 'second', quantity: 8 })).toEqual({
      costUsd: 0.4,
      confidence: 'estimated',
      source: 'estimate-api',
      quantity: { unit: 'second', value: 8 },
    });
  });
  it('is unknown when the estimate failed', () => {
    expect(resolveFalEstimate({ costUsd: null })).toMatchObject({ costUsd: null, confidence: 'unknown', source: 'estimate-api' });
  });
});

describe('resolveFalRun', () => {
  const controls = { resolution: '1080p', audio: true, durationSeconds: 5 };

  it("keeps fal's own estimate, which knows the account's pricing", () => {
    expect(
      resolveFalRun({ estimate: { costUsd: 0.5, unit: 'second', quantity: 5 }, endpointId: 'fal-ai/veo3.1', controls })
    ).toMatchObject({ costUsd: 0.5, source: 'estimate-api' });
  });

  it('falls back to the published rate when the estimate is empty', () => {
    expect(
      resolveFalRun({ estimate: { costUsd: null }, endpointId: 'fal-ai/veo3.1', controls })
    ).toEqual({
      costUsd: expect.closeTo(2, 6),
      confidence: 'estimated',
      source: 'catalog-rate',
      quantity: { unit: 'second', value: 5 },
    });
  });

  it('is unknown when neither source has a price', () => {
    expect(
      resolveFalRun({ estimate: null, endpointId: 'fal-ai/veo3.1', controls: { resolution: '1080p' } })
    ).toMatchObject({ costUsd: null, confidence: 'unknown', source: 'estimate-api' });
  });
});

describe('resolveKieDelta', () => {
  it('converts a balance drop to dollars', () => {
    expect(resolveKieDelta({ before: 1000, after: 940, sharedWith: 0 })).toEqual({
      costUsd: expect.closeTo(0.3, 6),
      confidence: 'estimated',
      source: 'balance-delta',
      quantity: { unit: 'credit', value: 60 },
    });
  });
  it('splits the drop with other jobs that overlapped, and says so', () => {
    expect(resolveKieDelta({ before: 1000, after: 940, sharedWith: 2 })).toEqual({
      costUsd: expect.closeTo(0.1, 6),
      confidence: 'estimated',
      source: 'balance-delta',
      quantity: { unit: 'credit', value: 20 },
      note: 'Balance change shared with 2 other Kie jobs.',
    });
  });
  it('is unknown without a before or after reading, or when the balance rose or held', () => {
    expect(resolveKieDelta({ before: undefined, after: 940, sharedWith: 0 })).toMatchObject({ costUsd: null, confidence: 'unknown' });
    expect(resolveKieDelta({ before: 1000, after: null, sharedWith: 0 })).toMatchObject({ costUsd: null, confidence: 'unknown' });
    expect(resolveKieDelta({ before: 900, after: 1000, sharedWith: 0 })).toMatchObject({ costUsd: null, note: expect.stringContaining('rose') });
    expect(resolveKieDelta({ before: 1000, after: 1000, sharedWith: 0 })).toMatchObject({ costUsd: null, note: expect.stringContaining('did not change') });
  });
});

describe('kieSharers', () => {
  const base: KieJob = {
    id: 'a', taskId: 'a', protocol: 'market', state: 'success', resultUrls: [],
    modelId: 'nano-banana-pro', mediaType: 'image', inputMode: 'text', prompt: 'p',
    createdAt: 1_000, updatedAt: 5_000, pollAttempt: 1,
  };
  it('counts other jobs submitted or succeeded during this job, not ones merely polling', () => {
    const jobs: KieJob[] = [
      base,
      { ...base, id: 'b', createdAt: 2_000, updatedAt: 3_000 },
      { ...base, id: 'c', createdAt: 500, updatedAt: 4_000 },
      { ...base, id: 'd', createdAt: 100, updatedAt: 900 },
      { ...base, id: 'e', createdAt: 2_500, updatedAt: 2_600, state: 'fail' },
      { ...base, id: 'f', createdAt: 400, updatedAt: 4_500, state: 'generating' },
    ];
    expect(kieSharers(jobs, base)).toBe(2);
  });
});

describe('resolveHelper', () => {
  it('passes the micro-AI estimate through', () => {
    expect(resolveHelper({ promptTokens: 100, completionTokens: 20, costUsd: 0.0000024 })).toEqual({
      costUsd: 0.0000024,
      confidence: 'estimated',
      source: 'catalog-rate',
      quantity: { unit: 'token', value: 120 },
    });
  });
});
