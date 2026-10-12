// cloud/tests/input-mimes.test.ts
import { describe, expect, it } from 'vitest';
import { isSupportedInputMime } from '../src/assets';
import { STAGEABLE_INPUT_MIMES, IMAGE_INPUT_MIMES } from '../../lib/providers/input-mimes';
import { EDIT_VIDEO_MIMES } from '../../lib/providers/video-edit';
import { REFERENCE_AUDIO_MIMES } from '../../lib/providers/reference-clips';

describe('stageable input types', () => {
  it('is the union of image, edit-video and reference-audio lists', () => {
    expect([...STAGEABLE_INPUT_MIMES]).toEqual([...IMAGE_INPUT_MIMES, ...EDIT_VIDEO_MIMES, ...REFERENCE_AUDIO_MIMES]);
    for (const mime of STAGEABLE_INPUT_MIMES) expect(isSupportedInputMime(mime)).toBe(true);
    expect(isSupportedInputMime('video/ogg')).toBe(false);
    expect(isSupportedInputMime('audio/aac')).toBe(false);
  });
});
