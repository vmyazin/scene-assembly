// tests/providers/reference-clips.test.ts
import { describe, expect, it } from 'vitest';
import {
  ATLAS_SEEDANCE_25_REFERENCE_CLIPS,
  SEEDANCE_20_REFERENCE_CLIPS,
  SEEDANCE_25_REFERENCE_CLIPS,
  clipToken,
  referenceClipCountError,
  referenceClipFileError,
  referenceClipProbeError,
  referenceClipSetError,
  referenceClipsFor,
} from '@/lib/providers/reference-clips';
import { findModel } from '@/lib/providers/catalog';

describe('reference clip limits', () => {
  const video = SEEDANCE_25_REFERENCE_CLIPS.video!;
  const audio = SEEDANCE_25_REFERENCE_CLIPS.audio!;

  it('accepts an mp4 or wav inside the byte cap and rejects the rest', () => {
    expect(referenceClipFileError(video, { name: 'move.mp4', type: 'video/mp4', size: 1_000 })).toBeNull();
    expect(referenceClipFileError(video, { name: 'move.mov', type: '', size: 1_000 })).toBeNull();
    expect(referenceClipFileError(video, { name: 'move.webm', type: 'video/webm', size: 1_000 })).toMatch(/MP4 or MOV/);
    expect(referenceClipFileError(audio, { name: 'voice.wav', type: '', size: 1_000 })).toBeNull();
    expect(referenceClipFileError(audio, { name: 'voice.mp3', type: 'audio/mpeg', size: 16_000_000 })).toMatch(/15 MB/);
  });

  it('checks duration, edges, pixels and frame rate only when a rate was read', () => {
    expect(referenceClipProbeError(video, { durationSeconds: 1.2, width: 640, height: 640 })).toMatch(/2–30 seconds/);
    expect(referenceClipProbeError(video, { durationSeconds: 8, width: 100, height: 100 })).toMatch(/300 and 6000/);
    expect(referenceClipProbeError(video, { durationSeconds: 8, width: 1920, height: 1080 }, 25)).toMatch(/30 seconds or shorter/);
    const atlas = ATLAS_SEEDANCE_25_REFERENCE_CLIPS.video!;
    expect(referenceClipProbeError(atlas, { durationSeconds: 4, width: 1280, height: 720, fps: 12 })).toMatch(/24–60 fps/);
    expect(referenceClipProbeError(atlas, { durationSeconds: 4, width: 1280, height: 720 })).toBeNull();
  });

  it('refuses Seedance 2.0 audio that has no picture', () => {
    expect(referenceClipCountError(SEEDANCE_20_REFERENCE_CLIPS.video!, 4)).toMatch(/up to 3/);
    expect(referenceClipSetError(SEEDANCE_20_REFERENCE_CLIPS, { images: 0, videos: 0, audios: 1 })).toMatch(/cannot use audio on its own/);
    expect(referenceClipSetError(SEEDANCE_25_REFERENCE_CLIPS, { images: 0, videos: 0, audios: 1 })).toBeNull();
    expect(referenceClipSetError(SEEDANCE_20_REFERENCE_CLIPS, { images: 0, videos: 1, audios: 1 })).toBeNull();
  });

  it('is absent on Wan and present on Seedance text and reference modes', () => {
    expect(referenceClipsFor(findModel('runware', 'alibaba:wan@3.0'), 'reference')).toBeUndefined();
    expect(referenceClipsFor(findModel('runware', 'bytedance:seedance@2.5'), 'text')?.video?.max).toBe(10);
    expect(referenceClipsFor(findModel('runware', 'bytedance:seedance@2.5'), 'frames')).toBeUndefined();
    expect(referenceClipsFor(findModel('runware', 'bytedance:seedance@2.5'), 'edit')).toBeUndefined();
    expect(referenceClipsFor(findModel('atlas', 'bytedance/seedance-2.0-fast/reference-to-video'), 'reference')?.audioRequiresVisual).toBe(true);
    expect(clipToken('at-image-index', 'Video', 0)).toBe('@Video1');
    expect(clipToken('image-index', 'Audio', 1)).toBe('Audio 2');
  });
});
