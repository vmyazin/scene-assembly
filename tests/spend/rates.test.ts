// tests/spend/rates.test.ts
import { describe, expect, it } from 'vitest';

import { FAL_IMAGE_MODELS, FAL_VIDEO_MODELS } from '@/lib/fal/catalog';
import { DEFAULT_GEMINI_IMAGE_MODEL, GEMINI_IMAGE_MODELS } from '@/lib/engines/gemini-catalog';
import { SINGLE_IMAGE_MODELS } from '@/lib/account/models';
import {
  DEFAULT_GEMINI_MODEL_ID,
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
  const BANANA = 'gemini-nano-banana-2.1';
  const LITE = 'gemini-3.1-flash-lite-image';

  it('prices output tokens at each model\u2019s published rate', () => {
    expect(geminiTokenCost(PRO, 0, 1120)).toBeCloseTo(0.1344, 6);
    expect(geminiTokenCost(PRO, 0, 2000)).toBeCloseTo(0.24, 6);
    expect(geminiTokenCost(FLASH, 0, 1120)).toBeCloseTo(0.0672, 6);
    expect(geminiTokenCost(LITE, 0, 1120)).toBeCloseTo(0.0336, 6);
    expect(geminiTokenCost(BANANA, 0, 1120)).toBeCloseTo(0.0336, 6);
    expect(geminiTokenCost(BANANA, 0, 1680)).toBeCloseTo(0.0504, 6);
    expect(geminiTokenCost(BANANA, 0, 3780)).toBeCloseTo(0.1134, 6);
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
    expect(geminiResolutionCost(BANANA, '1K', 0)).toBeCloseTo(0.0336, 4);
    expect(geminiResolutionCost(BANANA, '2K', 0)).toBeCloseTo(0.0504, 4);
    expect(geminiResolutionCost(BANANA, '4K', 0)).toBeCloseTo(0.1134, 4);
  });

  it('adds each reference image, and answers Nano Banana 2.1 for an unknown model', () => {
    expect(geminiResolutionCost(PRO, '4K', 2)).toBeCloseTo(0.24 + 2 * 0.00112, 6);
    expect(DEFAULT_GEMINI_MODEL_ID).toBe(DEFAULT_GEMINI_IMAGE_MODEL);
    expect(SINGLE_IMAGE_MODELS.gemini).toBe(DEFAULT_GEMINI_IMAGE_MODEL);
    expect(geminiResolutionCost(undefined, undefined, 0)).toBeCloseTo(0.0336, 6);
    expect(geminiResolutionCost('gemini-9-retired', '1K', 0)).toBeCloseTo(0.0336, 6);
  });

  it('falls back to a size the model does publish rather than pricing nothing', () => {
    // Lite has no 4K entry; a stale 4K preference must still price at its 1K rate.
    expect(geminiResolutionCost(LITE, '4K', 0)).toBeCloseTo(0.0336, 6);
  });

  it('covers every catalogued model, and labels the picker rows', () => {
    expect(GEMINI_IMAGE_MODELS.filter((model) => !GEMINI_IMAGE_RATES[model.id])).toEqual([]);
    // Three places, the same rounding every fal row uses: $0.0336 reads $0.034.
    expect(geminiRateLabel(BANANA)).toBe('$0.034\u20130.113 / image');
    expect(geminiRateLabel(BANANA, '4K')).toBe('$0.113 / image');
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
    const endpoints = [...FAL_IMAGE_MODELS, ...FAL_VIDEO_MODELS].flatMap((model) =>
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
    expect(falPublishedCost('google/nano-banana-2.1', { resolution: '1K' })?.costUsd).toBeCloseTo(0.04, 6);
    expect(falPublishedCost('google/nano-banana-2.1', { resolution: '2K' })?.costUsd).toBeCloseTo(0.059, 6);
    expect(falPublishedCost('google/nano-banana-2.1/edit', { resolution: '4K' })?.costUsd).toBeCloseTo(0.134, 6);
    expect(falPublishedCost('google/nano-banana-2.1', { resolution: '1K', webSearch: true })?.costUsd).toBeCloseTo(0.04, 6);
    // fal bills each reference as about 1,120 input tokens at $1.764/M, and high
    // thinking at the 2026-10-07 measured gap above the short-prompt price.
    const perImage = (1120 * 1.764) / 1_000_000;
    expect(falPublishedCost('google/nano-banana-2.1/edit', { resolution: '1K', thinkingLevel: 'medium', inputImages: 14 })?.costUsd).toBeCloseTo(0.04 + 14 * perImage, 6);
    expect(falPublishedCost('google/nano-banana-2.1', { resolution: '1K', thinkingLevel: 'high' })?.costUsd).toBeCloseTo(0.0494, 6);
    expect(falPublishedCost('google/nano-banana-2.1', { resolution: '2K', thinkingLevel: 'high' })?.costUsd).toBeCloseTo(0.0732, 6);
    expect(falPublishedCost('google/nano-banana-2.1', { resolution: '4K', thinkingLevel: 'minimal' })?.costUsd).toBeCloseTo(0.134, 6);
    expect(falPublishedCost('fal-ai/nano-banana-2', { resolution: '1K', thinkingLevel: 'high', inputImages: 14 })?.costUsd).toBeCloseTo(0.08, 6);
  });

  it('prices MiniMax H3 Max Turbo at the regular per-second rates, plus the documented overrun', () => {
    const endpoint = 'minimax/h3-max-turbo/image-to-video';
    // The clip can run up to about 0.7 s longer than requested, and fal bills output seconds.
    expect(falPublishedCost(endpoint, { resolution: '480P', durationSeconds: 1 })).toEqual({
      costUsd: expect.closeTo(1.7 * 0.025, 6),
      unit: 'second',
      quantity: 1.7,
    });
    expect(falPublishedCost(endpoint, { resolution: '768P', durationSeconds: 5 })?.costUsd).toBeCloseTo(5.7 * 0.04, 6);
    expect(falPublishedCost(endpoint, { resolution: '1080P', durationSeconds: 1 })?.costUsd).toBeCloseTo(1.7 * 0.08, 6);
    expect(falPublishedCost(endpoint, { resolution: '720p', durationSeconds: 5 })).toBeNull();
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
