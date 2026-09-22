import { describe, expect, it } from 'vitest';

import { findModel, PROVIDER_MODELS } from '@/lib/providers/catalog';
import { sizeRateKey, type ProviderModel } from '@/lib/providers/types';

import { resolveCatalogRate } from '@/lib/spend/resolve';

describe('provider catalog rates', () => {
  it('gives Atlas models flat or resolution-specific published rates', () => {
    const atlas = Object.fromEntries(PROVIDER_MODELS.atlas.map((model) => [model.id, model.rate]));
    expect(atlas).toEqual({
      'black-forest-labs/flux-schnell': { usd: 0.003, per: 'image' },
      'z-image/turbo': { usd: 0.005, per: 'image' },
      'qwen-image-3.0/text-to-image': { usd: 0.04, per: 'image' },
      'qwen-image-3.0/edit': { usd: 0.04, per: 'image' },
      'ltx-2.3-quality/text-to-video': { usd: 0.002, per: 'second' },
      'bytedance/seedance-v1-pro-fast/image-to-video': { usd: 0.009, per: 'second' },
      'bytedance/seedream-v5.0-pro/text-to-image': { usd: 0.036, per: 'image' },
      'bytedance/seedream-v5.0-pro/edit': { usd: 0.036, per: 'image', extraInputImageUsd: 0.003 },
      'bytedance/seedance-2.0-mini/text-to-video': { usdByResolution: { '480p': 0.0113, '720p': 0.0242, '1080p-SR': 0.0435 }, per: 'second' },
      'bytedance/seedance-2.0-mini/image-to-video': { usdByResolution: { '480p': 0.0113, '720p': 0.0242, '1080p-SR': 0.0435 }, per: 'second' },
      'bytedance/seedance-2.0-mini/reference-to-video': { usdByResolution: { '480p': 0.0113, '720p': 0.0242, '1080p-SR': 0.0435 }, per: 'second' },
      'bytedance/seedance-2.0-fast/text-to-video': { usdByResolution: { '480p': 0.027, '720p': 0.0581 }, per: 'second' },
      'bytedance/seedance-2.0-fast/image-to-video': { usdByResolution: { '480p': 0.027, '720p': 0.0581 }, per: 'second' },
      'bytedance/seedance-2.0-fast/reference-to-video': { usdByResolution: { '480p': 0.027, '720p': 0.0581 }, per: 'second' },
      // Atlas quotes 2.5 at one flat rate for every resolution it offers.
      'bytedance/seedance-2.5/text-to-video': { usd: 0.134, per: 'second' },
      'bytedance/seedance-2.5/image-to-video': { usd: 0.134, per: 'second' },
      'bytedance/seedance-2.5/reference-to-video': { usd: 0.134, per: 'second' },
      // Developer editions. Nano Banana 2 is the one family Atlas prices flat
      // across 1K/2K/4K, which is why it is the only one offering the tier.
      'google/nano-banana-2/text-to-image-developer': { usd: 0.028, per: 'image' },
      'google/nano-banana-2/edit-developer': { usd: 0.028, per: 'image' },
      'google/nano-banana-2-lite/text-to-image-developer': { usd: 0.014, per: 'image' },
      'google/nano-banana-2-lite/edit-developer': { usd: 0.014, per: 'image' },
      // Pinned to the 1K tier, so the $0.03 on the card is the tier charged.
      'openai/gpt-image-2.5-sunburst-developer/text-to-image': { usd: 0.03, per: 'image' },
      'openai/gpt-image-2.5-sunburst-developer/edit': { usd: 0.03, per: 'image' },
      'openai/gpt-image-2.5-flare-developer/text-to-image': { usd: 0.03, per: 'image' },
      'openai/gpt-image-2.5-flare-developer/edit': { usd: 0.03, per: 'image' },
      // The two `-sr` upscales are deliberately absent: Atlas publishes no
      // price for them, and an absent tier must not bill at the cheapest one.
      'minimax/h3-developer/text-to-video': { usdByResolution: { '480P': 0.015, '768P': 0.015 }, per: 'second' },
      'minimax/h3-developer/image-to-video': { usdByResolution: { '480P': 0.015, '768P': 0.015 }, per: 'second' },
      'minimax/h3-developer/reference-to-video': { usdByResolution: { '480P': 0.015, '768P': 0.015 }, per: 'second' },
    });
  });

  it('leaves metered Comet models without a rate', () => {
    expect(PROVIDER_MODELS.comet.every((model) => model.rate === undefined)).toBe(true);
  });

  it('shows a published price for each structured rate', () => {
    for (const models of Object.values(PROVIDER_MODELS)) {
      for (const model of models) {
        if (model.rate) expect(model.price).toMatch(/^\$\d/);
      }
    }
  });
});


describe('Atlas billing settings', () => {
  it.each([
    ['mini', '480p', 0.0565],
    ['mini', '720p', 0.121],
    ['mini', '1080p (upscaled)', 0.2175],
    ['fast', '480p', 0.135],
    ['fast', '720p', 0.2905],
  ])('prices a 5-second %s clip at %s across all input modes', (tier, size, expected) => {
    for (const mode of ['text-to-video', 'image-to-video', 'reference-to-video']) {
      const model = findModel('atlas', `bytedance/seedance-2.0-${tier}/${mode}`);
      const figure = resolveCatalogRate(model, 5, 1, { size });
      expect(figure.costUsd).toBeCloseTo(Number(expected), 6);
      expect(figure.confidence).toBe('estimated');
    }
  });

  it.each([
    ['mini', undefined], ['mini', '1440p (upscaled)'], ['mini', '4K'],
    ['fast', '1080p (upscaled)'], ['fast', '1440p (upscaled)'],
  ])('does not substitute the cheapest %s price for size %s', (tier, size) => {
    expect(resolveCatalogRate(findModel('atlas', `bytedance/seedance-2.0-${tier}/text-to-video`), 5, 1, { size }))
      .toMatchObject({ costUsd: null, confidence: 'unknown' });
  });

  it.each([undefined, 0, -1, NaN, Infinity])('requires a finite positive duration (%s)', duration => {
    expect(resolveCatalogRate(findModel('atlas', 'bytedance/seedance-2.0-mini/text-to-video'), duration, 1, { size: '720p' }))
      .toMatchObject({ costUsd: null, confidence: 'unknown' });
  });

  it.each([[1, 0.036], [3, 0.042], [10, 0.063]])('includes the first of %s Seedream references', (inputImages, expected) => {
    expect(resolveCatalogRate(findModel('atlas', 'bytedance/seedream-v5.0-pro/edit'), undefined, 1, { inputImages }).costUsd)
      .toBeCloseTo(expected, 6);
  });

  it('does not multiply reference input charges by the number of outputs', () => {
    expect(resolveCatalogRate(findModel('atlas', 'bytedance/seedream-v5.0-pro/edit'), undefined, 2, { inputImages: 3 }).costUsd)
      .toBeCloseTo(0.078, 6);
  });

  it('does not silently omit an unknown reference surcharge', () => {
    expect(resolveCatalogRate(findModel('atlas', 'bytedance/seedream-v5.0-pro/edit')))
      .toMatchObject({ costUsd: null, confidence: 'unknown' });
  });

  // 2.5 is quoted flat, so unlike the 2.0 tiers there is no size it cannot
  // price \u2014 including the upscales, which is the whole reason they are offered.
  it.each(['text-to-video', 'image-to-video', 'reference-to-video'])(
    'prices a 5-second Seedance 2.5 %s clip at every size it offers',
    mode => {
      const model = findModel('atlas', `bytedance/seedance-2.5/${mode}`);
      for (const size of model?.sizes ?? []) {
        expect(resolveCatalogRate(model, 5, 1, { size: size.label }))
          .toMatchObject({ costUsd: 0.67, confidence: 'estimated' });
      }
    }
  );
});

describe('Runware Seedance 2.5 billing settings', () => {
  const model = findModel('runware', 'bytedance:seedance@2.5');

  // Runware publishes no preset, so the rate is found through the leading tier
  // of the label \u2014 every shape inside a tier bills the same per second.
  it.each([['480p', 0.51], ['720p', 1.15], ['1080p', 3.07]])(
    'prices a 5-second %s clip at the tier rate whatever its shape',
    (tier, expected) => {
      const sizes = (model?.sizes ?? []).filter(size => size.label.startsWith(`${tier} `));
      expect(sizes.length).toBeGreaterThan(1);
      for (const size of sizes) {
        expect(resolveCatalogRate(model, 5, 1, { size: size.label }).costUsd)
          .toBeCloseTo(Number(expected), 6);
      }
    }
  );
});

/** Every dollar amount written in a display string. */
function figuresIn(price: string): number[] {
  return [...price.matchAll(/\$(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
}

/** Every dollar amount the arithmetic form carries, whichever shape it takes. */
function figuresOf(rate: NonNullable<ProviderModel['rate']>): number[] {
  const base = [...(rate.usd !== undefined ? [rate.usd] : Object.values(rate.usdByResolution)), ...Object.values(rate.audioUsdByResolution ?? {})];
  return rate.extraInputImageUsd === undefined ? base : [...base, rate.extraInputImageUsd];
}

/**
 * `price` is copy and `rate` is arithmetic, and they are the same money written
 * twice. Atlas generates its string from its table, so those cannot drift; the
 * Runware tiers are transcribed by hand, and a figure that drifted there would
 * show one number and bill another — the failure the rate field exists to stop.
 */
describe('hand-written prices and rates agree', () => {
  const priced = Object.values(PROVIDER_MODELS).flat().filter(model => model.rate && model.price);

  it('covers the tiered Runware models this guard was written for', () => {
    expect(priced.map(model => model.id)).toEqual(expect.arrayContaining([
      'alibaba:wan@3.0', 'lightricks:ltx@2.5-fast', 'bytedance:seedance@2.0-mini', 'alibaba:wan@2.6-flash',
    ]));
  });

  it.each(priced.map(model => [model.id, model] as const))(
    '%s writes the same figures in price and rate',
    (_id, model) => {
      expect([...new Set(figuresOf(model.rate!))].sort()).toEqual([...new Set(figuresIn(model.price!))].sort());
    }
  );

  it('files every resolution tier under a key one of its own sizes produces', () => {
    // A tier no size can reach would price nothing, silently.
    for (const model of priced) {
      const table = model.rate?.usdByResolution;
      if (!table) continue;
      const reachable = new Set((model.sizes ?? []).map(sizeRateKey));
      for (const key of Object.keys(table)) expect(reachable).toContain(key);
    }
  });
});

describe('Runware tiers reach the same resolver as Atlas', () => {
  const seedance = findModel('runware', 'bytedance:seedance@2.0-mini');

  it('prices the report s own example: $0.081 / s at 720p over 4 seconds', () => {
    const figure = resolveCatalogRate(seedance, 4, 1, { size: '720p · 16:9' });
    expect(figure.costUsd).toBeCloseTo(0.324, 6);
    expect(figure.confidence).toBe('estimated');
  });

  it('charges the cheaper tier when the cheaper tier is chosen', () => {
    expect(resolveCatalogRate(seedance, 4, 1, { size: '480p · 16:9' }).costUsd).toBeCloseTo(0.144, 6);
  });

  it('reads the tier from the label when the vendor names no preset', () => {
    // These sizes carry width and height, not a preset; the label leads with
    // the tier the per-second price is quoted at.
    expect(sizeRateKey({ label: '480p · 16:9', width: 864, height: 496 })).toBe('480p');
    expect(sizeRateKey({ label: '1080p (upscaled)', preset: '1080p-SR' })).toBe('1080p-SR');
  });

  it('leaves a size the vendor never priced unpriced, rather than guessing', () => {
    // LTX sells 2K and 4K while quoting only 720p and 1080p.
    const ltx = findModel('runware', 'lightricks:ltx@2.5-fast');
    expect(resolveCatalogRate(ltx, 4, 1, { size: '720p · 16:9' }).costUsd).toBeCloseTo(0.36, 6);
    expect(resolveCatalogRate(ltx, 4, 1, { size: '4K · 16:9' })).toMatchObject({ costUsd: null, confidence: 'unknown' });
    expect(resolveCatalogRate(seedance, 4, 1)).toMatchObject({ costUsd: null, confidence: 'unknown' });
  });
});
