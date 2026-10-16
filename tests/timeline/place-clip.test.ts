import { beforeEach, describe, expect, it, vi } from 'vitest';

const success = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...args: unknown[]) => success(...args), error: vi.fn() } }));

import { describePlacement, placeClipOnTimeline } from '@/lib/timeline/place-clip';
import { useGalleryStore } from '@/store/useGalleryStore';
import { useTimelineStore } from '@/store/useTimelineStore';

const portrait = { width: 496, height: 864, auto: true };

/**
 * The H5 finding: a landscape result was appended to an old portrait edit
 * behind a bare "Added to the timeline", and only showed up as a letterboxed
 * strip the next time the timeline was opened.
 */
describe('describePlacement', () => {
  it('names a first clip as the start of the timeline, with nothing to mismatch', () => {
    expect(describePlacement({ clipsBefore: 0, clip: { width: 1280, height: 720 }, frame: portrait }))
      .toEqual({ title: 'Started your timeline with this clip' });
  });

  it('says where the clip landed and warns when its shape fights the frame', () => {
    const placed = describePlacement({ clipsBefore: 3, clip: { width: 1280, height: 720 }, frame: portrait });
    expect(placed.title).toBe('Added as clip 4 on your timeline');
    expect(placed.description).toBe(
      'This clip is landscape and the timeline is portrait (496×864), so it will show with bars. Change its fit or the output size on the timeline.'
    );
  });

  it('stays quiet when the shapes match within rounding', () => {
    expect(describePlacement({ clipsBefore: 2, clip: { width: 1918, height: 1080 }, frame: { width: 1920, height: 1080, auto: true } }).description)
      .toBeUndefined();
  });

  it('calls out a different shape with the same orientation', () => {
    expect(describePlacement({ clipsBefore: 1, clip: { width: 1440, height: 1080 }, frame: { width: 1920, height: 1080, auto: true } }).description)
      .toMatch(/^Its shape differs from the timeline's 1920×1080 frame/);
  });

  it('compares against a frame the user froze even on an empty timeline', () => {
    expect(describePlacement({ clipsBefore: 0, clip: { width: 1280, height: 720 }, frame: { ...portrait, auto: false } }).description)
      .toMatch(/landscape and the timeline is portrait/);
  });

  it('reports without a warning when the clip could not be measured', () => {
    expect(describePlacement({ clipsBefore: 2, clip: null, frame: portrait })).toEqual({ title: 'Added as clip 3 on your timeline' });
  });
});

describe('placeClipOnTimeline', () => {
  beforeEach(() => {
    success.mockClear();
    useTimelineStore.getState().clear();
    useGalleryStore.setState({ records: [] });
  });

  it('appends, reports, and offers an Undo that takes the placement back', async () => {
    useTimelineStore.getState().addClip('existing');
    await placeClipOnTimeline('cloud-new');

    expect(useTimelineStore.getState().timeline.clips.map((clip) => clip.recordId)).toEqual(['existing', 'cloud-new']);
    const [title, options] = success.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(title).toBe('Added as clip 2 on your timeline');
    expect(options.action.label).toBe('Undo');

    options.action.onClick();
    expect(useTimelineStore.getState().timeline.clips.map((clip) => clip.recordId)).toEqual(['existing']);
  });
});
