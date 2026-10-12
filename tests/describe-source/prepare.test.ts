// tests/describe-source/prepare.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INLINE_VIDEO_BYTES, prepareDescribeParts } from '@/lib/describe-source/prepare';

const sampleVideoStills = vi.hoisted(() => vi.fn());

vi.mock('@/lib/video-frame', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-frame')>('@/lib/video-frame');
  return { ...actual, sampleVideoStills };
});

describe('prepareDescribeParts', () => {
  beforeEach(() => {
    sampleVideoStills.mockReset();
  });

  it('sends a small image as itself', async () => {
    const file = new File([Uint8Array.of(1, 2, 3, 4)], 'still.png', { type: 'image/png' });
    const parts = await prepareDescribeParts([{ file, label: 'Image 1' }]);
    expect(parts).toEqual([{ mimeType: 'image/png', data: btoa(String.fromCharCode(1, 2, 3, 4)), label: 'Image 1' }]);
    expect(sampleVideoStills).not.toHaveBeenCalled();
  });

  it('sends a short video whole and samples a long one into stills', async () => {
    const short = new File([Uint8Array.of(9, 8, 7)], 'clip.mp4', { type: 'video/mp4' });
    const whole = await prepareDescribeParts([{ file: short, label: 'Source video' }]);
    expect(whole[0]).toMatchObject({ mimeType: 'video/mp4', label: 'Source video' });
    expect(sampleVideoStills).not.toHaveBeenCalled();

    sampleVideoStills.mockResolvedValue([
      { blob: new Blob([Uint8Array.of(1, 2)]), label: '0.0s' },
      { blob: new Blob([Uint8Array.of(3, 4)]), label: '1.0s' },
    ]);
    const long = new File([new Uint8Array(INLINE_VIDEO_BYTES + 1)], 'long.mp4', { type: 'video/mp4' });
    const stills = await prepareDescribeParts([{ file: long, label: 'Source video' }]);
    expect(sampleVideoStills).toHaveBeenCalledWith(long);
    expect(stills.map((part) => part.label)).toEqual(['0.0s', '1.0s']);
    expect(stills.every((part) => part.mimeType === 'image/jpeg')).toBe(true);
  });
});
