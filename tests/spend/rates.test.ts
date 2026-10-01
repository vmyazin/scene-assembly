// tests/spend/rates.test.ts
import { describe, expect, it } from 'vitest';

import { FAL_IMAGE_MODEL, FAL_VIDEO_MODELS } from '@/lib/fal/catalog';
import { GEMINI_IMAGE_MODELS } from '@/lib/engines/gemini-catalog';
import {
  FAL_RATES,
  GEMINI_IMAGE_RATES,
  falPublishedCost,
  geminiRateLabel,
  geminiResolutionCost,
  geminiTokenCost,
  KIE_USD_PER_CREDIT,
} from '@/lib/spend/rates';

describe('Gemini image rates', () => {
  const PRO = 'gemini-3-pro-image-preview';
  const FLASH = 'gemini-3.1-flash-image';
  const LITE = 'gemini-3.1-flash-lite-image';

  it('prices output tokens at each model\u2019s published rate', () => {
    expect(geminiTokenCost(PRO, 0, 1120)).toBeCloseTo(0.1344, 6);
    expect(geminiTokenCost(PRO, 0, 2000)).toBeCloseTo(0.24, 6);
    expect(geminiTokenCost(FLASH, 0, 1120)).toBeCloseTo(0.0672, 6);
    expect(geminiTokenCost(LITE, 0, 1120)).toBeCloseTo(0.0336, 6);
  });

  it('adds input tokens at the input rate', () => {
    expect(geminiTokenCost(PRO, 560, 0)).toBeCloseTo(0.00112, 6);
    expect(geminiTokenCost(LITE, 560, 0)).toBeCloseTo(0.00014, 6);
  });

  it('estimates every published per-image price from its resolution', () => {
    // https://ai.google.dev/gemini-api/docs/pricing, read 2026-09-09.
    expect(geminiResolutionCost(PRO, '1K', 0)).toBeCloseTo(0.134, 3);
    expect(geminiResolutionCost(PRO, '2K', 0)).toBeCloseTo(0.134, 3);
    expect(geminiResolutionCost(PRO, '4K', 0)).toBeCloseTo(0.24, 3);
    expect(geminiResolutionCost(FLASH, '1K', 0)).toBeCloseTo(0.067, 3);
    expect(geminiResolutionCost(FLASH, '2K', 0)).toBeCloseTo(0.101, 3);
    expect(geminiResolutionCost(FLASH, '4K', 0)).toBeCloseTo(0.151, 3);
    expect(geminiResolutionCost(LITE, '1K', 0)).toBeCloseTo(0.0336, 4);
  });

  it('adds each reference image, and answers Pro for an unknown model', () => {
    expect(geminiResolutionCost(PRO, '4K', 2)).toBeCloseTo(0.24 + 2 * 0.00112, 6);
    expect(geminiResolutionCost(undefined, undefined, 0)).toBeCloseTo(0.1344, 6);
    expect(geminiResolutionCost('gemini-9-retired', '1K', 0)).toBeCloseTo(0.1344, 6);
  });

  it('falls back to a size the model does publish rather than pricing nothing', () => {
    // Lite has no 4K entry; a stale 4K preference must still price at its 1K rate.
    expect(geminiResolutionCost(LITE, '4K', 0)).toBeCloseTo(0.0336, 6);
  });

  it('covers every catalogued model, and labels the picker rows', () => {
    expect(GEMINI_IMAGE_MODELS.filter((model) => !GEMINI_IMAGE_RATES[model.id])).toEqual([]);
    // Three places, the same rounding every fal row uses: $0.0336 reads $0.034.
    expect(geminiRateLabel(LITE)).toBe('$0.034 / image');
    expect(geminiRateLabel(FLASH)).toBe('$0.067\u20130.151 / image');
    expect(geminiRateLabel(FLASH, '4K')).toBe('$0.151 / image');
    expect(geminiRateLabel('gemini-9-retired')).toBeNull();
  });

  it('never returns a negative or non-finite figure', () => {
    expect(geminiTokenCost(PRO, Number.NaN, -5)).toBe(0);
  });

  it('publishes the Kie credit rate', () => {
    expect(KIE_USD_PER_CREDIT).toBe(0.005);
  });
});

describe('fal published rates', () => {
  it('covers every endpoint the fal catalog can submit to', () => {
    const endpoints = [FAL_IMAGE_MODEL, ...FAL_VIDEO_MODELS].flatMap((model) =>
      model.variants.map((variant) => variant.endpointId)
    );
    expect(endpoints.filter((endpointId) => !FAL_RATES[endpointId])).toEqual([]);
  });

  it('prices a Nano Banana 2 image by resolution and web search', () => {
    expect(falPublishedCost('fal-ai/nano-banana-2', { resolution: '1K' })).toEqual({
      costUsd: 0.08,
      unit: 'image',
      quantity: 1,
    });
    expect(falPublishedCost('fal-ai/nano-banana-2/edit', { resolution: '4K' })?.costUsd).toBeCloseTo(0.16, 6);
    expect(
      falPublishedCost('fal-ai/nano-banana-2', { resolution: '2K', webSearch: true })?.costUsd
    ).toBeCloseTo(0.135, 6);
  });

  it('prices Veo per second, with audio and 4K charged more', () => {
    expect(
      falPublishedCost('fal-ai/veo3.1/fast', { resolution: '1080p', audio: true, durationSeconds: 8 })
    ).toEqual({ costUsd: expect.closeTo(1.2, 6), unit: 'second', quantity: 8 });
    expect(
      falPublishedCost('fal-ai/veo3.1/fast', { resolution: '1080p', audio: false, durationSeconds: 8 })?.costUsd
    ).toBeCloseTo(0.8, 6);
    expect(
      falPublishedCost('fal-ai/veo3.1', { resolution: '4k', audio: true, durationSeconds: 4 })?.costUsd
    ).toBeCloseTo(2.4, 6);
  });

  it('prices Veo 3.1 Lite from the published audio and resolution table', () => {
    // https://fal.ai/models/fal-ai/veo3.1/lite — 720p $0.03 silent / $0.05 with
    // audio, 1080p $0.05 silent / $0.08 with audio. No 4K tier.
    expect(
      falPublishedCost('fal-ai/veo3.1/lite', { resolution: '720p', audio: false, durationSeconds: 8 })
    ).toEqual({ costUsd: expect.closeTo(0.24, 6), unit: 'second', quantity: 8 });
    expect(
      falPublishedCost('fal-ai/veo3.1/lite/image-to-video', { resolution: '720p', audio: true, durationSeconds: 4 })?.costUsd
    ).toBeCloseTo(0.2, 6);
    expect(
      falPublishedCost('fal-ai/veo3.1/lite/first-last-frame-to-video', { resolution: '1080p', audio: false, durationSeconds: 6 })?.costUsd
    ).toBeCloseTo(0.3, 6);
    expect(
      falPublishedCost('fal-ai/veo3.1/lite', { resolution: '1080p', audio: true, durationSeconds: 8 })?.costUsd
    ).toBeCloseTo(0.64, 6);
    expect(falPublishedCost('fal-ai/veo3.1/lite', { resolution: '4k', audio: true, durationSeconds: 8 })).toBeNull();
  });

  it('prices a Kling run, which has no resolution control', () => {
    expect(
      falPublishedCost('fal-ai/kling-video/v3/pro/text-to-video', { audio: true, durationSeconds: 5 })?.costUsd
    ).toBeCloseTo(0.84, 6);
  });

  it('prices Hailuo per run, by duration where it has one', () => {
    expect(
      falPublishedCost('fal-ai/minimax/hailuo-2.3/standard/text-to-video', { durationSeconds: 10 })
    ).toEqual({ costUsd: 0.56, unit: 'video', quantity: 1 });
    expect(falPublishedCost('fal-ai/minimax/hailuo-2.3/pro/image-to-video', {})).toEqual({
      costUsd: 0.49,
      unit: 'video',
      quantity: 1,
    });
  });

  it('answers null for a run fal never published a price for', () => {
    // Seedance bills 480p per output token, which needs a frame size we lack.
    expect(
      falPublishedCost('bytedance/seedance-2.0/text-to-video', { resolution: '480p', durationSeconds: 5 })
    ).toBeNull();
    // A per-second endpoint whose duration control read "auto".
    expect(falPublishedCost('fal-ai/wan/v2.7/text-to-video', { resolution: '720p' })).toBeNull();
    expect(falPublishedCost('fal-ai/some-new-model', { durationSeconds: 5 })).toBeNull();
  });
});
