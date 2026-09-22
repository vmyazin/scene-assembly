import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  APPROXIMATE_LEGEND,
  COMET_VIDEO_DIMENSIONS,
  deliveredShape,
  hasApproximateSize,
  imageDimensions,
  isApproximateLabel,
  isExactRatio,
  parseDimensions,
  ratioDimensions,
  ratioDrift,
  shapeName,
  sizeDimensions,
  withDimensions,
} from '@/lib/providers/output-size';
import { modelsFor } from '@/lib/providers/catalog';
import { runwareGenerateImage } from '@/lib/providers/runware';
import { atlasCreateImage } from '@/lib/providers/atlas';
import { cometGenerateImage } from '@/lib/providers/comet';
import { pollinationsResponse } from '@/lib/engines/pollinations';

afterEach(() => vi.unstubAllGlobals());

/**
 * The bug this file protects against: "9:16" was offered as a shape and
 * delivered as 768×1344 or 496×864, neither of which is 9:16, with nothing in
 * the app saying so.
 */
describe('reading a size honestly', () => {
  it('calls a pair exact only when the label is literally true', () => {
    expect(isExactRatio([720, 1280], '9:16')).toBe(true);
    expect(isExactRatio([496, 864], '9:16')).toBe(false);
    expect(isExactRatio([768, 1344], '9:16')).toBe(false);
    // 2% off is inside the "same shape" tolerance aspect-match uses to protect
    // a resolution choice, and deliberately outside this one.
    expect(isExactRatio([864, 496], '16:9')).toBe(false);
    expect(isExactRatio([834, 1112], '3:4')).toBe(true);
    expect(isExactRatio([1470, 630], '21:9')).toBe(true);
  });

  it('marks the ratio, not the pixels, because the pixels are the exact part', () => {
    expect(withDimensions('480p · 9:16', [496, 864])).toBe('480p · ≈9:16 · 496 × 864');
    expect(withDimensions('720p · 9:16', [720, 1280])).toBe('720p · 9:16 · 720 × 1280');
  });

  /**
   * The review finding this covers: `≈21:9` on Seedream's 2048 × 1152 says the
   * pixels are close to 21:9. They are 24% away, and they are a bang-on 16:9.
   * A mark that means "nearly" must not be spent on a shape that was swapped.
   */
  it('names the shape a substitution actually delivers instead of calling it near', () => {
    expect(withDimensions('21:9 (Ultra Wide)', [2048, 1152])).toBe(
      '21:9 (Ultra Wide) · delivers 16:9 · 2048 × 1152'
    );
    expect(withDimensions('3:2 (Classic Photo)', [1776, 1328])).toBe(
      '3:2 (Classic Photo) · delivers ≈4:3 · 1776 × 1328'
    );
    expect(withDimensions('21:9 (Ultra Wide)', [2048, 1152])).not.toContain('≈21:9');
  });

  it('says a shape plainly when it reduces, and only approximates when it does not', () => {
    expect(shapeName([2048, 1152])).toBe('16:9');
    expect(shapeName([1536, 640])).toBe('12:5');
    // 111:83 is what 1776 × 1328 reduces to, and it tells a reader nothing.
    expect(shapeName([1776, 1328])).toBe('≈4:3');
    expect(deliveredShape([768, 1344], '9:16')).toBeNull();
    expect(deliveredShape([2048, 1152], '21:9')).toBe('16:9');
    expect(ratioDrift([2048, 1152], '21:9')).toBeCloseTo(0.238, 3);
    expect(ratioDrift([768, 1344], '9:16')).toBeCloseTo(0.0159, 4);
  });

  it('spends the ≈ legend only where something is genuinely close', () => {
    expect(APPROXIMATE_LEGEND).toBe('“≈” marks a ratio the pixels come close to without being exactly it.');
    expect(APPROXIMATE_LEGEND).not.toMatch(/labelled ratio/);
    expect(isApproximateLabel('9:16 (Story/Reels)', [768, 1344])).toBe(true);
    expect(isApproximateLabel('21:9 (Ultra Wide)', [2048, 1152])).toBe(false);
    expect(isApproximateLabel('9:16 (Story/Reels)', [720, 1280])).toBe(false);
    expect(isApproximateLabel('480p', null)).toBe(false);
  });

  it('adds pixels to a label that claims no ratio, and marks nothing', () => {
    expect(withDimensions('Pro · landscape', [1792, 1024])).toBe('Pro · landscape · 1792 × 1024');
  });

  it('leaves a size that publishes no pixels exactly as it was', () => {
    expect(withDimensions('480p', null)).toBe('480p');
    expect(withDimensions('1080p (upscaled)', null)).toBe('1080p (upscaled)');
    expect(sizeDimensions({ label: 'Portrait 9:16', preset: 'portrait_9_16' })).toBeNull();
  });

  it('reads pixels from either place a catalog publishes them', () => {
    expect(sizeDimensions({ label: '480p · 9:16', width: 496, height: 864 })).toEqual([496, 864]);
    expect(sizeDimensions({ label: '768P · 9:16', preset: '768x1344' })).toEqual([768, 1344]);
    expect(parseDimensions('1024*1024')).toEqual([1024, 1024]);
    expect(parseDimensions('480p')).toBeNull();
  });

  it('asks for the legend only when a model has something to explain', () => {
    const seedance = modelsFor('runware', 'video').find((m) => m.id === 'bytedance:seedance@2.0-mini');
    const ltx = modelsFor('runware', 'video').find((m) => m.id === 'lightricks:ltx@2.5-fast');

    expect(hasApproximateSize(seedance?.sizes)).toBe(true);
    expect(hasApproximateSize(ltx?.sizes)).toBe(false);
    expect(APPROXIMATE_LEGEND).toContain('≈');
  });
});

/**
 * The tables moved out of the adapters so a control could read them. A control
 * that reads a stale copy is worse than one that shows nothing, so every table
 * is checked against what the adapter actually puts on the wire.
 */
describe('the shared table is the one the request uses', () => {
  const captureFetch = (payload: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers(),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('Runware sends the pixels the image control promises', async () => {
    const fetchMock = captureFetch({ data: [{ imageURL: 'https://im.runware.ai/a.png' }] });
    await runwareGenerateImage({
      apiKey: 'rw',
      model: 'runware:z-image@turbo',
      prompt: 'a lighthouse',
      aspectRatio: '9:16',
    });

    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect([task.width, task.height]).toEqual(imageDimensions('runware', undefined, '9:16'));
    expect([task.width, task.height]).toEqual([768, 1344]);
  });

  it('Atlas sends its own table, and Seedream sends Seedream’s', async () => {
    const fetchMock = captureFetch({ data: { id: 'pred-1' } });
    await atlasCreateImage({ apiKey: 'at', model: 'z-image/turbo', prompt: 'a lighthouse', aspectRatio: '9:16' });
    await atlasCreateImage({
      apiKey: 'at',
      model: 'bytedance/seedream-v5.0-pro/text-to-image',
      prompt: 'a lighthouse',
      aspectRatio: '9:16',
    });

    const sizes = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body as string).size);
    expect(sizes[0]).toBe('768*1344');
    expect(sizes[1]).toBe('1152*2048');
    expect(imageDimensions('atlas', 'z-image/turbo', '9:16')).toEqual([768, 1344]);
    expect(imageDimensions('atlas', 'bytedance/seedream-v5.0-pro/text-to-image', '9:16')).toEqual([1152, 2048]);
  });

  it('gives GPT Image 2.5 its own enum, and Nano Banana 2 no number at all', async () => {
    const fetchMock = captureFetch({ data: { id: 'pred-1' } });
    await atlasCreateImage({
      apiKey: 'at',
      model: 'openai/gpt-image-2.5-sunburst-developer/text-to-image',
      prompt: 'a lighthouse',
      aspectRatio: '3:2',
    });

    // The control and the request agree, and both stay inside the 1K tier the
    // catalog prices — an `x`, because this is the one Atlas model that takes one.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).size).toBe('1536x1024');
    expect(imageDimensions('atlas', 'openai/gpt-image-2.5-sunburst-developer/text-to-image', '3:2')).toEqual([1536, 1024]);

    // Nano Banana 2 publishes no pixel pair for a tier, so the control shows
    // none rather than inventing one to put beside the ratio.
    expect(imageDimensions('atlas', 'google/nano-banana-2/text-to-image-developer', '9:16')).toBeNull();
    expect(imageDimensions('atlas', 'google/nano-banana-2-lite/edit-developer', '1:1')).toBeNull();
  });

  it('Comet sends the pixels the image control promises', async () => {
    const fetchMock = captureFetch({ data: [{ url: 'https://cdn.cometapi.com/a.png' }] });
    await cometGenerateImage({ apiKey: 'cm', model: 'qwen-image', prompt: 'a lighthouse', aspectRatio: '9:16' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).size).toBe('864x1536');
    expect(imageDimensions('comet', undefined, '9:16')).toEqual([864, 1536]);
  });

  it('Pollinations asks for the pixels the image control promises', async () => {
    const fetchMock = captureFetch({});
    await pollinationsResponse({ prompt: 'a lighthouse', aspectRatio: '9:16' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('width=720&height=1280');
    expect(imageDimensions('pollinations', undefined, '9:16')).toEqual([720, 1280]);
  });

  it('keeps each table’s own fallback: images land square, Comet video lands wide', () => {
    expect(imageDimensions('runware', undefined, undefined)).toEqual([1024, 1024]);
    // 4:3 is not in the video table; the old lookup fell through to 16:9.
    expect(ratioDimensions(COMET_VIDEO_DIMENSIONS, '4:3', '16:9')).toEqual([1280, 720]);
  });

  it('shows nothing for an engine whose pixels the vendor decides', () => {
    for (const engine of ['gemini', 'fal', 'kie', 'piapi', 'cloudflare']) {
      expect(imageDimensions(engine, undefined, '9:16')).toBeNull();
    }
  });
});
