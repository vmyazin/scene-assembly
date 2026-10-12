// tests/describe-source/prepare.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_DESCRIBE_BYTES, MAX_DESCRIBE_PARTS, decodedByteLength } from '@/lib/describe-source/contract';
import { INLINE_VIDEO_BYTES, prepareDescribeParts } from '@/lib/describe-source/prepare';

const sampleVideoStills = vi.hoisted(() => vi.fn());

vi.mock('@/lib/video-frame', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-frame')>('@/lib/video-frame');
  return { ...actual, sampleVideoStills };
});

function stills() {
  return [
    { blob: new Blob([Uint8Array.of(1, 2)]), label: '0.0s' },
    { blob: new Blob([Uint8Array.of(3, 4)]), label: '1.0s' },
    { blob: new Blob([Uint8Array.of(5, 6)]), label: '2.0s' },
  ];
}

describe('prepareDescribeParts', () => {
  beforeEach(() => {
    sampleVideoStills.mockReset();
    sampleVideoStills.mockResolvedValue(stills());
  });

  it('sends a small image as itself', async () => {
    const file = new File([Uint8Array.of(1, 2, 3, 4)], 'still.png', { type: 'image/png' });
    const prepared = await prepareDescribeParts([{ file, label: 'Image 1' }]);
    expect(prepared.omitted).toEqual([]);
    expect(prepared.parts).toEqual([{ mimeType: 'image/png', data: btoa(String.fromCharCode(1, 2, 3, 4)), label: 'Image 1' }]);
    expect(sampleVideoStills).not.toHaveBeenCalled();
  });

  it('sends a short video whole only when Gemini will watch it', async () => {
    const short = new File([Uint8Array.of(9, 8, 7)], 'clip.mp4', { type: 'video/mp4' });
    const whole = await prepareDescribeParts([{ file: short, label: 'Source video' }], { inlineVideo: true });
    expect(whole.parts[0]).toMatchObject({ mimeType: 'video/mp4', label: 'Source video' });
    expect(sampleVideoStills).not.toHaveBeenCalled();
  });

  it('samples a short video when the shared tier is the only reader', async () => {
    const short = new File([Uint8Array.of(9, 8, 7)], 'clip.mp4', { type: 'video/mp4' });
    const prepared = await prepareDescribeParts([{ file: short, label: 'Source video' }]);
    expect(sampleVideoStills).toHaveBeenCalledWith(short);
    expect(prepared.parts.map((part) => part.label)).toEqual(['0.0s', '1.0s', '2.0s']);
    expect(prepared.parts.every((part) => part.mimeType === 'image/jpeg')).toBe(true);
  });

  it('samples a long video into stills', async () => {
    const long = new File([new Uint8Array(INLINE_VIDEO_BYTES + 1)], 'long.mp4', { type: 'video/mp4' });
    const prepared = await prepareDescribeParts([{ file: long, label: 'Source video' }], { inlineVideo: true });
    expect(sampleVideoStills).toHaveBeenCalledWith(long);
    expect(prepared.parts.map((part) => part.label)).toEqual(['0.0s', '1.0s', '2.0s']);
  });

  it('re-encodes images that together exceed the body cap', async () => {
    const shrinkImage = vi.fn(async () => new Blob([Uint8Array.of(1, 2, 3)]));
    const sources = [1, 2, 3].map((index) => ({
      file: new File([new Uint8Array(1_000_000)], `${index}.jpg`, { type: 'image/jpeg' }),
      label: `Image ${index}`,
    }));

    const prepared = await prepareDescribeParts(sources, { shrinkImage });
    const total = prepared.parts.reduce((sum, part) => sum + (decodedByteLength(part.data) ?? 0), 0);

    expect(total).toBeLessThanOrEqual(MAX_DESCRIBE_BYTES);
    expect(prepared.parts).toHaveLength(3);
    expect(shrinkImage).toHaveBeenCalled();
  });

  it('samples an inline clip when the clip plus an image exceed the body cap', async () => {
    const video = new File([new Uint8Array(1_400_000)], 'clip.mp4', { type: 'video/mp4' });
    const image = new File([new Uint8Array(1_200_000)], 'still.jpg', { type: 'image/jpeg' });
    const prepared = await prepareDescribeParts(
      [
        { file: video, label: 'Source video' },
        { file: image, label: 'Image 1' },
      ],
      { inlineVideo: true }
    );

    expect(sampleVideoStills).toHaveBeenCalledWith(video);
    expect(prepared.parts.map((part) => part.mimeType)).toEqual(['image/jpeg', 'image/jpeg', 'image/jpeg', 'image/jpeg']);
    expect(prepared.omitted).toEqual([]);
  });

  it('gives a clip one still when images already fill the part budget', async () => {
    const video = new File([new Uint8Array(32)], 'clip.mp4', { type: 'video/mp4' });
    const images = Array.from({ length: MAX_DESCRIBE_PARTS - 1 }, (_, index) => ({
      file: new File([Uint8Array.of(index + 1)], `${index}.png`, { type: 'image/png' }),
      label: `Image ${index + 1}`,
    }));

    const prepared = await prepareDescribeParts([{ file: video, label: 'Source video' }, ...images]);

    expect(prepared.omitted).toEqual([]);
    expect(prepared.parts.filter((part) => part.label.endsWith('s'))).toHaveLength(1);
    expect(prepared.parts.filter((part) => part.label.startsWith('Image'))).toHaveLength(MAX_DESCRIBE_PARTS - 1);
  });

  it('names a source that cannot take a part', async () => {
    const images = Array.from({ length: MAX_DESCRIBE_PARTS + 1 }, (_, index) => ({
      file: new File([Uint8Array.of(index + 1)], `${index}.png`, { type: 'image/png' }),
      label: `Image ${index + 1}`,
    }));

    const prepared = await prepareDescribeParts(images);

    expect(prepared.parts).toHaveLength(MAX_DESCRIBE_PARTS);
    expect(prepared.omitted).toEqual([`Image ${MAX_DESCRIBE_PARTS + 1}`]);
  });
});
