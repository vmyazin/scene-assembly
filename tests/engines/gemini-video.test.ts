// tests/engines/gemini-video.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RouteError } from '../../lib/providers/route-error';
import {
  GEMINI_VIDEO_SAFETY_MESSAGE,
  geminiDownloadVideo,
  geminiGenerateVideo,
  geminiPollVideoOperation,
} from '../../lib/engines/gemini';
import {
  DEFAULT_GEMINI_VIDEO_MODEL,
  GEMINI_OMNI_720P_USD_PER_SECOND,
  GEMINI_VIDEO_MODELS,
  RETIRED_GEMINI_VIDEO_MODEL_ID,
  geminiVideoDuration,
  geminiVideoDurationOptions,
  geminiVideoResolution,
  resolveGeminiVideoModel,
} from '../../lib/engines/gemini-video-catalog';

const VIDEO_URI = 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media';
const FILE_URL = 'https://generativelanguage.googleapis.com/v1beta/files/abc';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gemini video catalog', () => {
  it('offers Omni and maps the shut-down preview id onto it', () => {
    expect(GEMINI_VIDEO_MODELS.map((model) => model.id)).toEqual(['gemini-omni-1.1-flash']);
    expect(DEFAULT_GEMINI_VIDEO_MODEL).toBe('gemini-omni-1.1-flash');
    expect(resolveGeminiVideoModel(undefined).id).toBe('gemini-omni-1.1-flash');
    expect(resolveGeminiVideoModel(RETIRED_GEMINI_VIDEO_MODEL_ID).id).toBe('gemini-omni-1.1-flash');
    expect(GEMINI_OMNI_720P_USD_PER_SECOND).toBeCloseTo(0.10136, 6);
    expect(GEMINI_VIDEO_MODELS[0].usdPerSecond['720p']).toBe(GEMINI_OMNI_720P_USD_PER_SECOND);
    expect(GEMINI_VIDEO_MODELS[0].usdPerSecond['1080p']).toBeUndefined();
    expect(GEMINI_VIDEO_MODELS[0].supportsExtension).toBe(false);
    expect(GEMINI_VIDEO_MODELS[0].resolutions).toEqual(['360p', '720p', '1080p', '4k']);
    expect(GEMINI_VIDEO_MODELS[0].defaultResolution).toBe('720p');
    expect(GEMINI_VIDEO_MODELS[0].defaultDuration).toBe(8);
    expect(geminiVideoResolution(GEMINI_VIDEO_MODELS[0], 'nope')).toBe('720p');
  });

  it('keeps 3–10s at every resolution and defaults an omitted length to 8s', () => {
    const model = resolveGeminiVideoModel('gemini-omni-1.1-flash');
    expect(geminiVideoDuration(model, 4)).toBe(4);
    expect(geminiVideoDuration(model, 3)).toBe(3);
    expect(geminiVideoDuration(model, 2)).toBe(8);
    expect(geminiVideoDuration(model, undefined)).toBe(8);
    expect(geminiVideoDurationOptions(model)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('geminiGenerateVideo', () => {
  it('starts text-to-video on the Interactions API with a duration string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'v1_text',
        status: 'completed',
        output_video: { uri: VIDEO_URI, mime_type: 'video/mp4' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      geminiGenerateVideo({
        apiKey: 'test-key',
        prompt: 'A moonlit ocean',
        model: RETIRED_GEMINI_VIDEO_MODEL_ID,
        config: { resolution: '720p', durationSeconds: 6, aspectRatio: '16:9' },
      })
    ).resolves.toEqual({
      operation: 'files/abc',
      done: false,
      videoUri: VIDEO_URI,
      videoBytes: undefined,
      mimeType: 'video/mp4',
    });

    expect(fetchMock).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': 'test-key' },
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        model: 'gemini-omni-1.1-flash',
        input: 'A moonlit ocean',
        response_format: {
          type: 'video',
          aspect_ratio: '16:9',
          resolution: '720p',
          duration: '6s',
          delivery: 'uri',
        },
        background: true,
        store: true,
        stream: false,
      }),
    });
  });

  it('keeps an in-progress interaction open so the caller can poll its id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: 'v1_run', status: 'in_progress' })));
    await expect(geminiGenerateVideo({ apiKey: 'test-key', prompt: 'A moonlit ocean' })).resolves.toEqual({
      operation: 'v1_run',
      done: false,
    });
  });

  it('reports a completed interaction with no video instead of an open job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: 'v1_empty', status: 'completed' })));
    await expect(geminiGenerateVideo({ apiKey: 'test-key', prompt: 'A moonlit ocean' })).resolves.toEqual({
      operation: 'v1_empty',
      done: true,
      error: 'Gemini finished without a video. Please try again.',
    });
  });

  it('names a safety block from the Interactions error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: 'content_blocked', message: 'Input blocked: filters.' } }, 400)
      )
    );
    await expect(geminiGenerateVideo({ apiKey: 'test-key', prompt: 'A moonlit ocean' })).rejects.toMatchObject({
      message: GEMINI_VIDEO_SAFETY_MESSAGE,
      status: 400,
    });
  });

  it('treats a dropped create request as a job that may already be running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(geminiGenerateVideo({ apiKey: 'test-key', prompt: 'A moonlit ocean' })).rejects.toMatchObject({
      message: expect.stringContaining('may have started'),
      status: 0,
    });
  });

  it('sends one still plus the prompt as the image-to-video input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'v1_i2v',
        status: 'completed',
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'video', mime_type: 'video/mp4', data: btoa('mp4') }],
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await geminiGenerateVideo({
      apiKey: 'test-key',
      prompt: 'Animate the still',
      image: 'abc123',
      imageMimeType: 'image/jpeg',
      model: 'gemini-omni-1.1-flash',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('gemini-omni-1.1-flash');
    expect(body.input).toEqual([
      { type: 'image', data: 'abc123', mime_type: 'image/jpeg' },
      { type: 'text', text: 'Animate the still' },
    ]);
    expect(body.response_format.duration).toBe('8s');
    expect(body.response_format).not.toHaveProperty('personGeneration');
  });

  it('does not rewrite a short clip when the resolution is 1080p', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ output_video: { uri: VIDEO_URI } }));
    vi.stubGlobal('fetch', fetchMock);
    await geminiGenerateVideo({
      apiKey: 'test-key',
      prompt: 'Wide coastal road',
      config: { resolution: '1080p', durationSeconds: 4 },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toMatchObject({ resolution: '1080p', duration: '4s' });
  });

  it('rejects a missing API key without calling Gemini', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(geminiGenerateVideo({ apiKey: '  ', prompt: 'A moonlit ocean' })).rejects.toMatchObject({
      message: 'A Gemini API key is required.',
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps HTTP failures as RouteError with the vendor status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Omni is overloaded' } }, 503))
    );
    await expect(geminiGenerateVideo({ apiKey: 'test-key', prompt: 'A moonlit ocean' })).rejects.toBeInstanceOf(
      RouteError
    );
    await expect(geminiGenerateVideo({ apiKey: 'test-key', prompt: 'A moonlit ocean' })).rejects.toMatchObject({
      message: 'Omni is overloaded',
      status: 503,
    });
  });
});

describe('geminiPollVideoOperation', () => {
  it('polls an in-progress interaction, then a failed background block', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'v1_run', status: 'queued' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'v1_run',
          status: 'failed',
          errors: [{ code: 'safety', message: 'Request blocked due to safety violations.' }],
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(geminiPollVideoOperation('test-key', 'v1_run')).resolves.toEqual({
      operation: 'v1_run',
      done: false,
    });
    await expect(geminiPollVideoOperation('test-key', 'v1_run')).resolves.toEqual({
      operation: 'v1_run',
      done: true,
      error: GEMINI_VIDEO_SAFETY_MESSAGE,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/interactions/v1_run',
      { headers: { 'x-goog-api-key': 'test-key' } }
    );
  });

  it('hands a completed interaction with a file URI to the file poll', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 'v1_done',
          status: 'completed',
          output_video: { uri: VIDEO_URI, mime_type: 'video/mp4', data: btoa('mp4') },
        })
      )
    );
    await expect(geminiPollVideoOperation('test-key', 'v1_done')).resolves.toEqual({
      operation: 'files/abc',
      done: false,
      videoUri: VIDEO_URI,
      videoBytes: btoa('mp4'),
      mimeType: 'video/mp4',
    });
  });

  it('waits until the file is ACTIVE, then returns the download address', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'PROCESSING' }))
      .mockResolvedValueOnce(jsonResponse({ state: { name: 'ACTIVE' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(geminiPollVideoOperation('test-key', 'files/abc')).resolves.toMatchObject({
      operation: 'files/abc',
      done: false,
    });
    await expect(geminiPollVideoOperation('test-key', 'files/abc')).resolves.toEqual({
      operation: 'files/abc',
      done: true,
      videoUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media',
    });
    expect(fetchMock).toHaveBeenCalledWith(FILE_URL, { headers: { 'x-goog-api-key': 'test-key' } });
  });

  it('surfaces a failed file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ state: 'FAILED', error: { message: 'Unsafe audio' } })));
    await expect(geminiPollVideoOperation('test-key', 'files/abc')).resolves.toMatchObject({
      done: true,
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
