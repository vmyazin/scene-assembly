// tests/spend/capture.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { estimateFalJobCost, fetchKieCredits } = vi.hoisted(() => ({
  estimateFalJobCost: vi.fn(),
  fetchKieCredits: vi.fn(),
}));
vi.mock('@/lib/fal/browser', () => ({ estimateFalJobCost }));
vi.mock('@/lib/kie/browser', () => ({ fetchKieCredits }));

import type { FalJob } from '@/lib/fal/types';
import type { KieJob } from '@/lib/kie/types';
import {
  captureFalJob,
  captureGeminiVideo,
  captureHelper,
  captureImageResult,
  captureKieJob,
  captureProviderJob,
} from '@/lib/spend/capture';
import type { ProviderJob } from '@/store/useProviderJobsStore';
import { useSpendStore } from '@/store/useSpendStore';

const entries = () => useSpendStore.getState().entries;

beforeEach(() => {
  useSpendStore.setState({ entries: [] });
  estimateFalJobCost.mockReset();
  fetchKieCredits.mockReset();
});

describe('captureImageResult', () => {
  it('records PiAPI image resolution in the browser ledger', () => {
    captureImageResult({engine:'piapi',modelId:'nano-banana-2',prompt:'A lighthouse',inputImages:3,resolution:'4K'});
    expect(entries()[0]).toMatchObject({provider:'piapi',costUsd:0.12,confidence:'estimated'});
  });
  it('prices the actual Atlas Seedream tier and charges extra references', () => {
    captureImageResult({
      engine: 'atlas', modelId: 'bytedance/seedream-v5.0-pro/edit',
      prompt: 'p', inputImages: 3, resolution: '4K',
    });
    // The shared imageSize preference is not sent to Atlas; atlas.ts sends 1.5K.
    expect(entries()[0].costUsd).toBeCloseTo(0.042, 6);
  });
  it('files a Gemini run as exact when usage came back', () => {
    captureImageResult({
      engine: 'gemini',
      prompt: 'A harbour at dusk',
      inputImages: 0,
      resolution: '1K',
      usage: { promptTokens: 10, outputTokens: 1120 },
      galleryRecordId: 'result-1',
    });
    expect(entries()[0]).toMatchObject({
      provider: 'gemini',
      modelId: 'gemini-3-pro-image-preview',
      kind: 'image',
      confidence: 'exact',
      source: 'usage-metadata',
      promptExcerpt: 'A harbour at dusk',
      galleryRecordId: 'result-1',
    });
  });

  it('files a Gemini Veo clip from the catalog rate', () => {
    captureGeminiVideo({
      modelId: 'veo-3.1-lite-generate-preview',
      prompt: 'A moonlit ocean',
      inputMode: 'text',
      resolution: '720p',
      durationSeconds: 8,
      galleryRecordId: 'gemini-video-1',
    });
    expect(entries()[0]).toMatchObject({
      provider: 'gemini',
      modelId: 'veo-3.1-lite-generate-preview',
      kind: 'video',
      inputMode: 'text',
      costUsd: 0.4,
      confidence: 'estimated',
      source: 'catalog-rate',
      quantity: { unit: 'second', value: 8 },
      galleryRecordId: 'gemini-video-1',
    });
  });

  it('files free engines at zero', () => {
    captureImageResult({ engine: 'pollinations', prompt: 'p', inputImages: 0 });
    expect(entries()[0]).toMatchObject({ provider: 'pollinations', costUsd: 0, source: 'free' });
  });

  it('files an aggregator image with the response cost or the catalog rate', () => {
    captureImageResult({ engine: 'runware', modelId: 'runware:z-image@turbo', prompt: 'p', inputImages: 0, cost: 0.003 });
    captureImageResult({ engine: 'atlas', modelId: 'z-image/turbo', prompt: 'p', inputImages: 0 });
    captureImageResult({ engine: 'comet', modelId: 'gpt-image-2', prompt: 'p', inputImages: 0 });
    expect(entries().map((e) => [e.provider, e.costUsd, e.confidence])).toEqual([
      ['comet', null, 'unknown'],
      ['atlas', 0.005, 'estimated'],
      ['runware', 0.003, 'exact'],
    ]);
  });

  it('prices a fal image from the published table when there is no key', async () => {
    captureImageResult({ engine: 'fal', modelId: 'nano-banana-2', prompt: 'p', inputImages: 0, resolution: '2K' });
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(estimateFalJobCost).not.toHaveBeenCalled();
    expect(entries()[0]).toMatchObject({ costUsd: 0.12, confidence: 'estimated', source: 'catalog-rate' });
  });

  it('asks fal for an estimate on the image endpoint', async () => {
    estimateFalJobCost.mockResolvedValue({ costUsd: 0.039, unit: 'image', quantity: 1 });
    captureImageResult({ engine: 'fal', modelId: 'nano-banana-2', prompt: 'p', inputImages: 2, falApiKey: 'fal-key' });
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(estimateFalJobCost).toHaveBeenCalledWith({ apiKey: 'fal-key', endpointId: expect.stringContaining('nano-banana-2') });
    expect(entries()[0]).toMatchObject({ provider: 'fal', costUsd: 0.039, source: 'estimate-api', inputMode: 'image' });
  });
});

describe('captureFalJob', () => {
  const job: FalJob = {
    id: 'req-1', requestId: 'req-1', state: 'success', logs: [], modelId: 'veo-3-1-fast',
    mediaType: 'video', inputMode: 'text', prompt: 'A banana crossing the moon',
    controlValues: { duration: '8s' }, createdAt: 1, updatedAt: 2, pollAttempt: 1,
  };

  it('estimates from the variant endpoint and the duration control', async () => {
    estimateFalJobCost.mockResolvedValue({ costUsd: 1.2, unit: 'second', quantity: 8 });
    captureFalJob(job, 'fal-key');
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(estimateFalJobCost).toHaveBeenCalledWith({ apiKey: 'fal-key', endpointId: 'fal-ai/veo3.1/fast', durationSeconds: 8 });
    expect(entries()[0]).toMatchObject({ id: 'fal-req-1', galleryRecordId: 'fal-req-1', kind: 'video', costUsd: 1.2, quantity: { unit: 'second', value: 8 } });
  });

  it("falls back to fal's published rate when the estimate cannot answer", async () => {
    estimateFalJobCost.mockRejectedValue(new Error('offline'));
    // A real job carries every control the variant defines, defaults included.
    captureFalJob({ ...job, controlValues: { duration: '8s', resolution: '720p', generate_audio: true } }, 'fal-key');
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    // Veo 3.1 Fast at 720p with audio: $0.15 a second across 8 seconds.
    expect(entries()[0]).toMatchObject({
      costUsd: 1.2,
      confidence: 'estimated',
      source: 'catalog-rate',
      quantity: { unit: 'second', value: 8 },
    });
  });

  it('records unknown, not nothing, when neither source can price the run', async () => {
    estimateFalJobCost.mockResolvedValue({ costUsd: null });
    // Seedance's duration control defaults to "auto", so no second count exists.
    captureFalJob({ ...job, modelId: 'seedance-2', controlValues: { duration: 'auto' } }, 'fal-key');
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ costUsd: null, confidence: 'unknown' });
  });

  it('never throws into the success path, even for a job with a nullish prompt', () => {
    expect(() =>
      captureFalJob({ ...job, prompt: undefined as unknown as string }, 'fal-key')
    ).not.toThrow();
  });
});

describe('captureKieJob', () => {
  const job: KieJob = {
    id: 't-1', taskId: 't-1', protocol: 'market', state: 'success', resultUrls: [],
    modelId: 'nano-banana-pro', mediaType: 'image', inputMode: 'text', prompt: 'p',
    creditsBefore: 1000, createdAt: 1_000, updatedAt: 5_000, pollAttempt: 1,
  };

  it('bills the balance drop', async () => {
    fetchKieCredits.mockResolvedValue(940);
    captureKieJob(job, 'kie-key', [job]);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ id: 'kie-t-1', provider: 'kie', costUsd: 0.3, quantity: { unit: 'credit', value: 60 } });
  });

  it('splits with an overlapping job', async () => {
    fetchKieCredits.mockResolvedValue(940);
    captureKieJob(job, 'kie-key', [job, { ...job, id: 't-2', createdAt: 2_000 }]);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ costUsd: 0.15, note: 'Balance change shared with 1 other Kie job.' });
  });

  it('never throws into the success path, even for a job with a nullish prompt', () => {
    expect(() =>
      captureKieJob({ ...job, prompt: undefined as unknown as string }, 'kie-key', [job])
    ).not.toThrow();
  });
});

describe('captureProviderJob', () => {
  const job: ProviderJob = {
    id: 'runware-1', provider: 'runware', modelId: 'alibaba:wan@3.0', prompt: 'p', inputMode: 'text',
    state: 'success', urls: ['https://x/y.mp4'], controlValues: { duration: 5 }, createdAt: 1, updatedAt: 2, pollAttempt: 1,
  };

  it('uses the Runware response cost', () => {
    captureProviderJob('runware', job, { taskId: 'x', state: 'success', urls: job.urls, cost: 0.25 });
    expect(entries()[0]).toMatchObject({ id: 'runware-runware-1', galleryRecordId: 'runware-runware-1', kind: 'video', costUsd: 0.25, confidence: 'exact' });
  });

  it('uses the catalog rate and duration for Atlas', () => {
    captureProviderJob('atlas', { ...job, provider: 'atlas', modelId: 'ltx-2.3-quality/text-to-video' }, { taskId: 'x', state: 'success', urls: job.urls });
    expect(entries()[0]).toMatchObject({ costUsd: 0.01, confidence: 'estimated', quantity: { unit: 'second', value: 5 } });
  });

  it('uses the saved Atlas size rather than the currently selected or cheapest tier', () => {
    captureProviderJob('atlas', {
      ...job, provider: 'atlas', modelId: 'bytedance/seedance-2.0-mini/text-to-video',
      controlValues: { duration: 10, size: '720p' },
    }, { taskId: 'x', state: 'success', urls: job.urls });
    expect(entries()[0].costUsd).toBeCloseTo(0.242, 6);
  });
});

describe('captureHelper', () => {
  it('files a helper entry per request', () => {
    captureHelper({ promptTokens: 100, completionTokens: 20, costUsd: 0.0000024 }, 'meta-llama/Llama-3.1-8B-Instruct');
    expect(entries()[0]).toMatchObject({ provider: 'micro-ai', kind: 'helper', modelId: 'meta-llama/Llama-3.1-8B-Instruct', costUsd: 0.0000024 });
  });
});
