// tests/describe-source/contract.test.ts
import { describe, expect, it } from 'vitest';

import { decodedByteLength, parseDescribeRequest } from '@/lib/describe-source/contract';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import { descriptionSampleTimes, frameTimeLabel } from '@/lib/video-frame';

describe('parseDescribeRequest', () => {
  it('accepts one image and defaults the target to video', () => {
    const parsed = parseDescribeRequest({
      parts: [{ mimeType: 'image/png', data: 'AQIDBA==', label: 'Image 1' }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.target).toBe('video');
    expect(parsed.request.parts[0]).toMatchObject({ mimeType: 'image/png', label: 'Image 1' });
    expect(decodedByteLength('AQIDBA==')).toBe(4);
  });

  it('rejects an empty selection, a bad mime, and a payload past the body cap', () => {
    expect(parseDescribeRequest({ parts: [] })).toMatchObject({ ok: false, error: DESCRIBE_ERRORS.empty });
    expect(parseDescribeRequest({
      parts: [{ mimeType: 'application/pdf', data: 'AQIDBA==' }],
    })).toMatchObject({ ok: false, error: DESCRIBE_ERRORS.unsupported });

    const oversized = 'A'.repeat(3_333_336);
    expect(decodedByteLength(oversized)).toBeGreaterThan(2_500_000);
    expect(parseDescribeRequest({
      parts: [{ mimeType: 'image/jpeg', data: oversized, label: 'Image 1' }],
    })).toMatchObject({ ok: false, status: 413, error: DESCRIBE_ERRORS.tooLarge });
  });
});

describe('descriptionSampleTimes', () => {
  it('samples the open, the middle, and just before the end', () => {
    const times = descriptionSampleTimes(8);
    expect(times[0]).toBe(0);
    expect(times[1]).toBe(4);
    expect(times[2]).toBeCloseTo(7.99);
    expect(descriptionSampleTimes(0)).toEqual([0]);
    expect(descriptionSampleTimes(Number.NaN)).toEqual([0]);
    expect(frameTimeLabel(1.5)).toBe('1.5s');
  });

  it('collapses a clip that is shorter than a distinct middle', () => {
    expect(descriptionSampleTimes(0.02)).toEqual([0]);
  });
});
