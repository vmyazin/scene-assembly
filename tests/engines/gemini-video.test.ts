// tests/engines/gemini-video.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { generateVideos, getVideosOperation } = vi.hoisted(() => ({
  generateVideos: vi.fn(),
  getVideosOperation: vi.fn(),
}));

// Only the network surface is faked. `GenerateVideosOperation` stays real, because
// the SDK calls `_fromAPIResponse` on the operation we hand it: a plain object
// literal passes type-checking and then throws at runtime.
vi.mock('@google/genai', async () => ({
  ...(await vi.importActual<typeof import('@google/genai')>('@google/genai')),
  GoogleGenAI: class {
    constructor(public readonly options: { apiKey: string; httpOptions?: { retryOptions?: { attempts: number } } }) {}
    models = { generateVideos };
    operations = { getVideosOperation };
  },
}));

import { GenerateVideosOperation } from '@google/genai';

import { RouteError } from '../../lib/providers/route-error';
import {
  geminiDownloadVideo,
  geminiGenerateVideo,
  geminiPollVideoOperation,
} from '../../lib/engines/gemini';
import { geminiVideoDuration, geminiVideoDurationOptions, resolveGeminiVideoModel } from '../../lib/engines/gemini-video-catalog';

const VIDEO_URI = 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media';

afterEach(() => {
  generateVideos.mockReset();
  getVideosOperation.mockReset();
  vi.unstubAllGlobals();
});

describe('gemini video catalog', () => {
  it('forces 8s at 1080p so Google does not reject the paid call', () => {
    const model = resolveGeminiVideoModel('veo-3.1-lite-generate-preview');
    expect(geminiVideoDuration(model, 4, '720p')).toBe(4);
    expect(geminiVideoDuration(model, 4, '1080p')).toBe(8);
    expect(geminiVideoDuration(model, 6, '1080p')).toBe(8);
    expect(geminiVideoDurationOptions(model, '720p')).toEqual([4, 6, 8]);
    expect(geminiVideoDurationOptions(model, '1080p')).toEqual([8]);
  });
});

describe('geminiGenerateVideo', () => {
  it('starts text-to-video with catalog-narrowed config and singleAttempt', async () => {
    generateVideos.mockResolvedValue({
      name: 'operations/veo-text',
      done: false,
    });

    await expect(
      geminiGenerateVideo({
        apiKey: 'test-key',
        prompt: 'A moonlit ocean',
        model: 'veo-3.1-lite-generate-preview',
        singleAttempt: true,
        config: { resolution: '720p', durationSeconds: 6, aspectRatio: '16:9' },
      })
    ).resolves.toEqual({
      operation: 'operations/veo-text',
      done: false,
      videoUri: undefined,
      videoBytes: undefined,
      mimeType: undefined,
    });

    expect(generateVideos).toHaveBeenCalledWith({
      model: 'veo-3.1-lite-generate-preview',
      prompt: 'A moonlit ocean',
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '16:9',
        durationSeconds: 6,
        personGeneration: 'allow_all',
      },
    });
  });

  it('passes the still as imageBytes on the image-to-video path', async () => {
    generateVideos.mockResolvedValue({
      name: 'operations/veo-i2v',
      done: false,
    });

    await geminiGenerateVideo({
      apiKey: 'test-key',
      prompt: 'Animate the still',
      image: 'abc123',
      imageMimeType: 'image/jpeg',
      model: 'veo-3.1-lite-generate-preview',
    });

    expect(generateVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Animate the still',
        image: { imageBytes: 'abc123', mimeType: 'image/jpeg' },
        config: expect.objectContaining({ personGeneration: 'allow_adult', durationSeconds: 4 }),
      })
    );
  });

  it('clamps 1080p starts to 8 seconds', async () => {
    generateVideos.mockResolvedValue({ name: 'operations/veo-1080', done: false });
    await geminiGenerateVideo({
      apiKey: 'test-key',
      prompt: 'Wide coastal road',
      config: { resolution: '1080p', durationSeconds: 4 },
    });
    expect(generateVideos.mock.calls[0][0].config).toMatchObject({
      resolution: '1080p',
      durationSeconds: 8,
    });
  });

  it('rejects a missing API key without calling the SDK', async () => {
    await expect(geminiGenerateVideo({ apiKey: '  ', prompt: 'A moonlit ocean' })).rejects.toMatchObject({
      message: 'A Gemini API key is required.',
      status: 401,
    });
    expect(generateVideos).not.toHaveBeenCalled();
  });

  it('wraps SDK failures as RouteError with the vendor status', async () => {
    generateVideos.mockRejectedValue(Object.assign(new Error('Veo is overloaded'), { status: 503 }));
    await expect(geminiGenerateVideo({ apiKey: 'test-key', prompt: 'A moonlit ocean' })).rejects.toBeInstanceOf(
      RouteError
    );
    await expect(geminiGenerateVideo({ apiKey: 'test-key', prompt: 'A moonlit ocean' })).rejects.toMatchObject({
      message: 'Veo is overloaded',
      status: 503,
    });
  });
});

describe('geminiPollVideoOperation', () => {
  it('returns the video URI when the operation completes', async () => {
    getVideosOperation.mockResolvedValue({
      name: 'operations/veo-text',
      done: true,
      response: { generatedVideos: [{ video: { uri: VIDEO_URI, mimeType: 'video/mp4' } }] },
    });

    await expect(geminiPollVideoOperation('test-key', 'operations/veo-text', { singleAttempt: true })).resolves.toEqual({
      operation: 'operations/veo-text',
      done: true,
      videoUri: VIDEO_URI,
      videoBytes: undefined,
      mimeType: 'video/mp4',
    });
    expect(getVideosOperation).toHaveBeenCalledWith({ operation: { name: 'operations/veo-text' } });
  });

  it('hands the SDK a real operation so it can convert the raw poll response', async () => {
    // Mirrors @google/genai: it converts the wire payload by calling
    // `_fromAPIResponse` on the very operation the caller passed in.
    getVideosOperation.mockImplementation(async ({ operation }: { operation: GenerateVideosOperation }) =>
      operation._fromAPIResponse({
        apiResponse: {
          name: 'operations/veo-raw',
          done: true,
          response: { generateVideoResponse: { generatedSamples: [{ video: { uri: VIDEO_URI } }] } },
        },
        _isVertexAI: false,
      })
    );

    await expect(geminiPollVideoOperation('test-key', 'operations/veo-raw', { singleAttempt: true })).resolves.toMatchObject({
      operation: 'operations/veo-raw',
      done: true,
      videoUri: VIDEO_URI,
    });
  });

  it('surfaces operation errors and RAI blocks', async () => {
    getVideosOperation.mockResolvedValueOnce({
      name: 'operations/fail',
      done: true,
      error: { message: 'The prompt was blocked.' },
    });
    await expect(geminiPollVideoOperation('test-key', 'operations/fail')).resolves.toMatchObject({
      done: true,
      error: 'The prompt was blocked.',
    });

    getVideosOperation.mockResolvedValueOnce({
      name: 'operations/rai',
      done: true,
      response: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['Unsafe audio'] },
    });
    await expect(geminiPollVideoOperation('test-key', 'operations/rai')).resolves.toMatchObject({
      error: 'Unsafe audio',
    });
  });
});

describe('geminiDownloadVideo', () => {
  it('fetches the Google URI with the API key header', async () => {
    const body = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]).buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'video/mp4' },
        arrayBuffer: async () => body,
      })
    );

    const blob = await geminiDownloadVideo('test-key', VIDEO_URI);
    expect(fetch).toHaveBeenCalledWith(VIDEO_URI, { headers: { 'x-goog-api-key': 'test-key' } });
    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBe(body.byteLength);
  });

  it('retries a 403 with the key on the query string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'video/mp4' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
    vi.stubGlobal('fetch', fetchMock);

    await geminiDownloadVideo('test-key', VIDEO_URI);
    expect(fetchMock.mock.calls[1][0]).toBe(`${VIDEO_URI}&key=test-key`);
  });

  it('decodes inline videoBytes when there is no URI', async () => {
    const blob = await geminiDownloadVideo('test-key', '', { videoBytes: btoa('mp4'), mimeType: 'video/mp4' });
    expect(await blob.text()).toBe('mp4');
    expect(blob.type).toBe('video/mp4');
  });

  it('refuses to fetch a non-Google URI', async () => {
    await expect(geminiDownloadVideo('test-key', 'https://evil.example/clip.mp4')).rejects.toMatchObject({
      message: 'Gemini returned an unusable video address.',
      status: 502,
    });
  });
});
