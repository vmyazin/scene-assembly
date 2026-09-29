import { describe, expect, it } from 'vitest';
import type { CloudJobRequest } from '@/lib/account/contracts';
import { describeModels, sampleRequest } from '@/lib/account/model-schema';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { resolveGemini } from '@/lib/spend/resolve';
import { estimateCloudJob, unknownPriceProviders } from '@/lib/spend/estimate';

const request = (patch: Partial<CloudJobRequest> = {}): CloudJobRequest => ({
  provider: 'gemini', modelId: 'gemini-3-pro-image-preview', mediaType: 'image', inputMode: 'text',
  prompt: 'painted clouds', values: { imageSize: '2K' }, referenceIds: [], ...patch,
});

describe('estimateCloudJob', () => {
  it('prices catalog-rate jobs exactly as the ledger will', () => {
    expect(estimateCloudJob(request({ provider: 'atlas', modelId: 'bytedance/seedance-2.0-fast/text-to-video', mediaType: 'video', values: { size: '720p', durationSeconds: 10 } })))
      .toMatchObject({ costUsd: expect.closeTo(0.581, 6), confidence: 'estimated' });
    expect(estimateCloudJob(request({ provider: 'atlas', modelId: 'black-forest-labs/flux-schnell', values: {} })).costUsd).toBeCloseTo(0.003);
    expect(estimateCloudJob(request({ provider: 'fal', modelId: 'nano-banana-2', values: { resolution: '2K', enable_web_search: true } })).costUsd).toBeCloseTo(0.135);
  });

  it('prices Gemini from its per-image rate and says the run decides', () => {
    const figure = estimateCloudJob(request({ inputMode: 'image', referenceIds: ['ref'] }));
    const expected = resolveGemini({ usage: undefined, modelId: 'gemini-3-pro-image-preview', resolution: '2K', inputImages: 1, outputImages: 1 });
    expect(figure).toMatchObject({ costUsd: expected.costUsd, confidence: 'estimated' });
    expect(figure.note).toMatch(/final figure comes from the run/);
  });

  it('is unknown, never guessed, where the ledger waits on the provider', () => {
    for (const provider of ['runware', 'kie', 'cloudflare', 'pollinations'] as const) {
      const figure = estimateCloudJob(request({ provider, modelId: 'any', values: {} }));
      expect(figure, provider).toMatchObject({ costUsd: null, confidence: 'unknown' });
      expect(figure.note, provider).toMatch(/price/);
    }
  });

  it('agrees with a one-output ledger entry for every advertised model and mode', () => {
    const models = describeModels(['fal', 'kie', 'runware', 'atlas', 'comet', 'piapi', 'gemini', 'cloudflare', 'pollinations']);
    for (const model of models) for (const mode of model.modes) {
      const sample = sampleRequest(model, mode);
      const ledger = buildAccountSpendEntry({ jobId: 'x', request: sample, result: { sources: [{}] }, at: 0 });
      expect(estimateCloudJob(sample).costUsd, `${model.provider} ${model.modelId} ${mode.mode}`).toBe(ledger?.confidence === 'unknown' ? null : ledger?.costUsd ?? null);
    }
  });
});

describe('unknownPriceProviders', () => {
  it('names the providers a default grant refuses, and whether that is all their models', () => {
    const result = unknownPriceProviders(describeModels(['kie', 'runware', 'gemini']));
    expect(result).toEqual(expect.arrayContaining([
      { provider: 'kie', label: 'Kie.ai', scope: 'all' },
      { provider: 'runware', label: 'Runware', scope: 'all' },
    ]));
    expect(result.find(entry => entry.provider === 'gemini')).toBeUndefined();
  });
});
