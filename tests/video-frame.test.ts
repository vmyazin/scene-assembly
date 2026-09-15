import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractLastFrame,
  extractLastFrameFromBlob,
  FRAME_EXTRACTION_ERROR,
  isVideoFile,
  lastFrameFileName,
  lastFrameFilename,
  lastFrameSeekTarget,
  seekToLastFrame,
  type SeekableVideo,
} from '../lib/video-frame';

/**
 * jsdom cannot decode video, so the seek choreography is exercised against a
 * double. Whether a real decoder paints the frame is a manual check.
 */
class FakeVideo implements SeekableVideo {
  duration: number;
  readonly seeks: number[] = [];
  private time = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(
    duration: number,
    private readonly onSeek?: (video: FakeVideo, requested: number) => void
  ) {
    this.duration = duration;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(value: number) {
    this.seeks.push(value);
    this.onSeek?.(this, value);
    this.time = Number.isFinite(this.duration) ? Math.min(value, this.duration) : value;
    this.emit('seeked');
  }

  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

describe('lastFrameSeekTarget', () => {
  it('samples inside the final frame of a known duration', () => {
    // Verified against a real 8s/24fps clip: 7.99 decodes frame 191 of 192,
    // where a 50ms epsilon decoded frame 190.
    expect(lastFrameSeekTarget(8)).toBeCloseTo(7.99);
    expect(lastFrameSeekTarget(8, 0.5)).toBeCloseTo(7.5);
  });

  it('stays inside the final frame at 60fps, where one frame is 16.7ms', () => {
    expect(8 - lastFrameSeekTarget(8)!).toBeLessThan(1 / 60);
  });

  it('never returns a negative time for a clip shorter than the epsilon', () => {
    expect(lastFrameSeekTarget(0.005)).toBe(0);
  });

  it.each([
    [Number.POSITIVE_INFINITY, 'not yet buffered'],
    [Number.NaN, 'metadata not yet parsed'],
    [0, 'an empty video'],
  ])('returns null for %p (%s)', (duration) => {
    expect(lastFrameSeekTarget(duration)).toBeNull();
  });
});

describe('seekToLastFrame', () => {
  it('seeks once to just before the end when the duration is known', async () => {
    const video = new FakeVideo(8);

    await seekToLastFrame(video);

    expect(video.seeks).toEqual([7.99]);
  });

  it('probes past the end first when the duration is still Infinity', async () => {
    // A fragmented MP4 only reveals its duration once a seek runs off the end.
    const video = new FakeVideo(Number.POSITIVE_INFINITY, (current) => {
      current.duration = 6;
    });

    await seekToLastFrame(video);

    expect(video.seeks).toEqual([1e7, 5.99]);
  });

  it('gives up when the duration never resolves', async () => {
    const video = new FakeVideo(Number.POSITIVE_INFINITY);

    await expect(seekToLastFrame(video)).rejects.toThrow(FRAME_EXTRACTION_ERROR);
  });

  it('resolves without awaiting a seeked event that would never fire', async () => {
    // Already parked on the target: assigning the same currentTime emits nothing.
    const video = new FakeVideo(8);
    video.currentTime = 7.99;
    video.seeks.length = 0;

    await seekToLastFrame(video);

    expect(video.seeks).toEqual([]);
  });

  it('rejects when the element reports a decode error mid-seek', async () => {
    const video = new FakeVideo(8, (current) => current.emit('error'));

    await expect(seekToLastFrame(video)).rejects.toThrow(FRAME_EXTRACTION_ERROR);
  });

  it('rejects rather than hanging when no seeked event ever arrives', async () => {
    vi.useFakeTimers();
    try {
      const stalled = {
        currentTime: 0,
        duration: 8,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      } satisfies SeekableVideo;

      const pending = seekToLastFrame(stalled);
      const assertion = expect(pending).rejects.toThrow(FRAME_EXTRACTION_ERROR);
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('extractLastFrame guards', () => {
  const CLIP_URL = 'https://v3.fal.media/files/tiger/clip.mp4';
  const CLOUD_PATH = '/api/account/assets/asset-1/content';

  afterEach(() => vi.unstubAllGlobals());

  it('refuses a URL it would not download', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractLastFrame('http://insecure.example/clip.mp4')).rejects.toThrow(
      FRAME_EXTRACTION_ERROR
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a failed response', () => new Response('nope', { status: 404 })],
    [
      'a non-video body',
      () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ],
  ])('refuses %s from both the CDN and the app', async (_label, makeResponse) => {
    vi.stubGlobal('fetch', vi.fn(async () => makeResponse()));

    await expect(extractLastFrame(CLIP_URL)).rejects.toThrow(FRAME_EXTRACTION_ERROR);
  });

  /**
   * The bug this covers: every cloud-library card addresses its clip by the
   * relative `/api/account/assets/<id>/content`, and the downloadable-URL guard
   * parses an absolute URL — so a path with no origin was refused before any
   * request went out, and "Save last frame" failed on every cloud clip.
   */
  it('reads a cloud clip addressed by a relative app route', async () => {
    const fetchMock = vi.fn(async () => new Response('', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    // Rejected at the decode, in jsdom, which is past the guard that used to
    // refuse this address outright.
    await expect(extractLastFrame(CLOUD_PATH)).rejects.toThrow(FRAME_EXTRACTION_ERROR);
    const [requested] = fetchMock.mock.calls[0] as unknown as [string];
    expect(String(requested)).toBe(CLOUD_PATH);
  });

  it('does not proxy its own route, which would arrive without the session', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractLastFrame(CLOUD_PATH)).rejects.toThrow(FRAME_EXTRACTION_ERROR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The bug this covers: a cross-origin clip with no CORS headers plays in the
   * preview element and cannot be read by `fetch`, so the button failed only on
   * the deployed origin. The app's own route has to be asked for the bytes.
   */
  it('falls back to the app route when the CDN refuses the browser', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === CLIP_URL) throw new TypeError('Failed to fetch');
      // Empty, so the decode this cannot do in jsdom is never reached.
      return new Response('', { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractLastFrame(CLIP_URL)).rejects.toThrow(FRAME_EXTRACTION_ERROR);
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/download-video');
  });
});

describe('extractLastFrameFromBlob guards', () => {
  it.each([
    ['an empty file', 0],
    ['a file past the size ceiling', 513 * 1024 * 1024],
  ])('refuses %s without attempting a decode', async (_label, size) => {
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const blob = { size, type: 'video/mp4' } as Blob;

    await expect(extractLastFrameFromBlob(blob)).rejects.toThrow(FRAME_EXTRACTION_ERROR);
    expect(createObjectURL).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('isVideoFile', () => {
  it.each([
    ['clip.mp4', 'video/mp4', true],
    ['clip.mov', 'video/quicktime', true],
    ['frame.png', 'image/png', false],
    ['notes.txt', 'text/plain', false],
  ])('%s (%s) → %s', (name, type, expected) => {
    expect(isVideoFile(new File([], name, { type }))).toBe(expected);
  });
});

describe('lastFrameFileName', () => {
  it.each([
    ['previous-take.mp4', 'previous-take-last-frame.png'],
    ['clip.with.dots.mov', 'clip.with.dots-last-frame.png'],
    ['no-extension', 'no-extension-last-frame.png'],
    ['.mp4', 'video-last-frame.png'],
  ])('%j becomes %j', (input, expected) => {
    expect(lastFrameFileName(input)).toBe(expected);
  });
});

describe('lastFrameFilename', () => {
  it('marks the frame as coming from the end of its clip', () => {
    expect(lastFrameFilename('neon-tiger-in-the-rain')).toBe(
      'neon-tiger-in-the-rain-last-frame.png'
    );
  });
});
