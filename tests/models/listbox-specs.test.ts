// tests/models/listbox-specs.test.ts
import { describe, expect, it } from 'vitest';

import { findModel } from '@/lib/providers/catalog';
import { FAL_VIDEO_MODELS } from '@/lib/fal/catalog';
import { KIE_MODELS } from '@/lib/kie/catalog';
import {
  compactPrice,
  falVideoSpecs,
  fieldSpecs,
  kieImageSpecs,
  kieVideoSpecs,
  providerImageSpecs,
  providerVideoSpecs,
  ratioOfSize,
  snapRatio,
  sortRatios,
  tierRange,
  topTier,
  type SpecCell,
} from '@/lib/models/listbox-specs';

const textOf = (cell: SpecCell) => (cell.kind === 'text' ? cell.value : cell.kind === 'shapes' ? cell.ratios : cell.on);

describe('listbox spec derivation', () => {
  it('reads length, top resolution, shapes and price off an aggregator video model', () => {
    // CometAPI's Wan 2.7: 4–15s, 720p–1080p presets in three shapes, metered.
    const cells = providerVideoSpecs(findModel('comet', 'wan2.7')!).map(textOf);
    expect(cells).toEqual(['15s', '1080p', ['16:9', '1:1', '9:16'], 'metered']);
  });

  it('snaps near-miss pixel pairs to the nearest named ratio and names odd tiers by their long side', () => {
    // Sora 2 Pro publishes 1792×1024: 1.75, not quite 16:9, and no broadcast tier.
    const cells = providerVideoSpecs(findModel('comet', 'sora-2-pro')!).map(textOf);
    expect(cells[1]).toBe('1792px');
    expect(cells[2]).toEqual(['16:9', '9:16']);
    expect(snapRatio(1344, 768)).toBe('16:9');
    expect(snapRatio(2520, 1080)).toBe('21:9');
    expect(snapRatio(1440, 1080)).toBe('4:3');
    expect(snapRatio(4000, 1000)).toBe('4:1');
  });

  it('falls back to the tier span when the sizes are bare tiers that draw no shape', () => {
    // Runware's Wan 3.0 lists 480p / 720p / 1080p presets and nothing about shape.
    const cells = providerVideoSpecs(findModel('runware', 'alibaba:wan@3.0')!).map(textOf);
    expect(cells).toEqual(['30s', '1080p', '480p–1080p', '$0.05/s']);
  });

  it('prints P-Video-Edit From at the four-digit draft promo, not a rounded sticker', () => {
    const cells = providerVideoSpecs(findModel('runware', 'prunaai:p-video@edit')!, 'edit').map(textOf);
    expect(cells).toEqual(['15s', '848px', 'source', '$0.0188/s']);
  });

  it('says "fixed" for a video model with no seconds control', () => {
    const cells = providerVideoSpecs(findModel('atlas', 'ltx-2.3-quality/text-to-video')!).map(textOf);
    expect(cells[0]).toBe('fixed');
    expect(cells[2]).toEqual(['16:9', '1:1', '9:16']);
  });

  it('prefers a declared aspect-ratio list over the tier span', () => {
    const cells = providerVideoSpecs(findModel('piapi', 'kling-3-omni')!).map(textOf);
    expect(cells[2]).toEqual(['16:9', '1:1', '9:16']);
  });

  it('gives image models a price, a reference count and an edit mark', () => {
    expect(providerImageSpecs(findModel('runware', 'runware:108@22')!).map(textOf)).toEqual(['$0.0166/1024²', '3', true]);
    // Text-only, no references: the cells say so rather than hide.
    expect(providerImageSpecs(findModel('comet', 'gpt-image-2')!).map(textOf)).toEqual(['metered', '—', false]);
    expect(providerImageSpecs(findModel('atlas', 'black-forest-labs/flux-schnell')!).map(textOf)).toEqual(['$0.003/img', '1', true]);
  });

  it('reads fal and Kie columns off their control fields', () => {
    const wan = FAL_VIDEO_MODELS.find((model) => model.id === 'wan-2-7')!;
    const [length, tier, shapes, from] = falVideoSpecs(wan, 'text').map(textOf);
    expect([length, tier, shapes]).toEqual(['15s', '1080p', ['16:9', '1:1', '9:16']]);
    expect(from).toMatch(/^\$[\d.]+\/s$/);

    const kling = KIE_MODELS.find((model) => model.id === 'kling-3-0')!;
    expect(kieVideoSpecs(kling, 'text').map(textOf)).toEqual(['10s', '1080p', ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']]);

    // Kie's Veo fixes its length and resolution, so those cells are dashes, not guesses.
    const veo = KIE_MODELS.find((model) => model.id === 'veo-3-1')!;
    expect(kieVideoSpecs(veo, 'text').map(textOf)).toEqual(['—', '—', ['16:9', '9:16']]);

    const nano = KIE_MODELS.find((model) => model.id === 'nano-banana-pro')!;
    expect(kieImageSpecs(nano, 'text').map(textOf)).toEqual(['4K', ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'], '8']);
  });

  it('handles the small helpers', () => {
    expect(fieldSpecs([{ key: 'duration', type: 'number', min: 2, max: 15 }]).seconds).toBe(15);
    expect(ratioOfSize({ label: 'Portrait · 720p' })).toBe('9:16');
    expect(ratioOfSize({ label: '480p' })).toBeUndefined();
    expect(sortRatios(['9:16', '1:1', '16:9', '16:9'])).toEqual(['16:9', '1:1', '9:16']);
    expect(topTier([{ label: '480p' }, { label: '1080p (upscaled)' }])).toBe('1080p');
    expect(tierRange([{ label: '720p · 16:9' }])).toBe('720p');
    expect(compactPrice('$0.094 / 5s @ 360p · $0.248 / 5s @ 1080p')).toBe('$0.094/5s');
  });
});
