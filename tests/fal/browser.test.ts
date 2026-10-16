import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelFalJob,
  getFalJobStatus,
  runFalImage,
  submitFalJob,
  uploadFalFiles,
} from '../../lib/fal/browser';
import { FAL_JOB_TIMEOUT_MS } from '../../lib/fal/queue';
import type { FalTask } from '../../lib/fal/types';

const apiKey = 'id:secret';
const requestId = 'req_12345678';

const unsafeFalUrls = [
  ['insecure HTTP', 'http://v3.fal.media/image.png'],
  ['javascript scheme', 'javascript:alert(1)'],
  ['data scheme', 'data:image/png;base64,AAAA'],
  ['credentials', 'https://user:pass@v3.fal.media/image.png'],
  ['leading whitespace', ' https://v3.fal.media/image.png'],
  ['trailing whitespace', 'https://v3.fal.media/image.png '],
  ['relative URL', '/images/image.png'],
  ['malformed URL', '::not a URL::'],
  ['HTTPS off-domain host', 'https://example.com/image.png'],
  ['lookalike fal host', 'https://fal.media.example.com/image.png'],
] as const;

const safeFalUrls = [
  ['root host', 'https://fal.media/image.png'],
  ['CDN subdomain', 'https://v3.fal.media/image.png'],
] as const;

const validImageSignatures = [
  ['image/png', 'png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', 'jpg', [0xff, 0xd8, 0xff, 0xe0]],
  [
    'image/webp',
    'webp',
    [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  ],
  [
    'image/avif',
    'avif',
    [0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0],
  ],
] as const;

function imageResponse(bytes: readonly number[], mimeType: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': mimeType },
  });
}

const submitArgs = {
  apiKey,
  modelId: 'nano-banana-2.1',
  mediaType: 'image' as const,
  inputMode: 'text' as const,
  prompt: 'A banana observatory',
  uploadUrls: [] as string[],
  values: { aspect_ratio: '16:9', resolution: '1K', enable_web_search: false },
};

const taskArgs = {
  apiKey,
  modelId: 'nano-banana-2.1',
  mediaType: 'image' as const,
  inputMode: 'text' as const,
  requestId,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successTask(overrides: Partial<FalTask> = {}): FalTask {
  return {
    requestId,
    state: 'success',
    logs: [],
    resultUrl: 'https://v3.fal.media/image.png',
    mimeType: 'image/png',
    ...overrides,
  };
}

function queueBodies(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/fal/queue')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

function expectOneSubmitAndNoCancel(fetchMock: ReturnType<typeof vi.fn>) {
  const bodies = queueBodies(fetchMock);
  expect(bodies.filter((body) => body.operation === 'submit')).toHaveLength(1);
  expect(bodies.filter((body) => body.operation === 'cancel')).toHaveLength(0);
}

function pendingUntilAborted(init?: RequestInit, guardSignal?: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    const guardTimer = setTimeout(
      () => reject(new Error('test guard: request remained pending past deadline')),
      FAL_JOB_TIMEOUT_MS + 1
    );
    if (signal?.aborted) {
      clearTimeout(guardTimer);
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(guardTimer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
    if (guardSignal?.aborted) {
      clearTimeout(guardTimer);
      queueMicrotask(() => reject(new Error('test guard: caller abort was not composed')));
      return;
    }
    guardSignal?.addEventListener(
      'abort',
      () => {
        clearTimeout(guardTimer);
        queueMicrotask(() => reject(new Error('test guard: caller abort was not composed')));
      },
      { once: true }
    );
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fal browser route transport', () => {
  it('uploads each File with real FormData and preserves URL order', async () => {
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.webp', { type: 'image/webp' }),
    ];
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      (url: string, init?: RequestInit) => {
        void url;
        void init;
        return new Promise<Response>((resolve) => pending.push(resolve));
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = uploadFalFiles(apiKey, files);
    expect(fetchMock).toHaveBeenCalledOnce();
    const expectUploadCall = (index: number) => {
      const [, init] = fetchMock.mock.calls[index];
      expect(init).toMatchObject({ method: 'POST' });
      const form = (init as RequestInit).body;
      expect(form).toBeInstanceOf(FormData);
      expect((form as FormData).get('apiKey')).toBe(apiKey);
      expect((form as FormData).get('file')).toBe(files[index]);
    };
    expectUploadCall(0);

    pending[0](jsonResponse({ success: true, url: 'https://fal.media/first.png' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectUploadCall(1);
    pending[1](jsonResponse({ success: true, url: 'https://fal.media/second.webp' }));

    await expect(result).resolves.toEqual([
      'https://fal.media/first.png',
      'https://fal.media/second.webp',
    ]);
  });

  it('rejects safe upload route errors and malformed successes without leaking credentials', async () => {
    const file = new File(['source'], 'source.png', { type: 'image/png' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'Upload refused.' }, 400))
      .mockResolvedValueOnce(jsonResponse({ success: true, url: 42 }))
      .mockRejectedValueOnce(new TypeError(`network failed with ${apiKey}`));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadFalFiles(apiKey, [file])).rejects.toThrow('Upload refused.');
    await expect(uploadFalFiles(apiKey, [file])).rejects.toThrow(
      'fal did not return a temporary file URL.'
    );
    const networkError = await uploadFalFiles(apiKey, [file]).catch((error: unknown) => error);
    expect(networkError).toBeInstanceOf(Error);
    expect(String(networkError)).not.toContain(apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(unsafeFalUrls)('rejects an upload URL with %s without echoing it', async (_case, url) => {
    const file = new File(['source'], 'source.png', { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, url }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await uploadFalFiles(apiKey, [file]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('fal did not return a temporary file URL.');
    expect(String(error)).not.toContain(url);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(safeFalUrls)('accepts an exact-trim credential-free HTTPS upload URL on the %s', async (_case, url) => {
    const file = new File(['source'], 'source.png', { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, url })));

    await expect(uploadFalFiles(apiKey, [file])).resolves.toEqual([url]);
  });

  it('submits exactly once with only the required catalog and request fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, requestId })
    );
    vi.stubGlobal('fetch', fetchMock);
    const argsWithUntrustedFields = {
      ...submitArgs,
      endpointId: 'attacker/model',
      endpointUrl: 'https://attacker.example/steal',
    };

    await expect(submitFalJob(argsWithUntrustedFields)).resolves.toEqual({ requestId });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/fal/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'submit', ...submitArgs }),
    });
  });

  it.each([
    { success: true },
    { success: true, requestId: 'short' },
    { success: true, requestId: 'request/id/is/not/allowed' },
  ])('rejects malformed submit success payloads: %j', async (payload) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitFalJob(submitArgs)).rejects.toThrow(
      'fal did not return a valid request ID.'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(unsafeFalUrls)('rejects a successful status URL with %s without echoing it', async (_case, url) => {
    const task = successTask({ resultUrl: url });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, task }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await getFalJobStatus(taskArgs).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('fal did not return a valid task status.');
    expect(String(error)).not.toContain(url);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(safeFalUrls)('accepts an exact-trim credential-free HTTPS status URL on the %s', async (_case, url) => {
    const task = successTask({ resultUrl: url });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, task })));

    await expect(getFalJobStatus(taskArgs)).resolves.toEqual(task);
  });

  it('uses a safe route submit error and does not retry the POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: 'fal is rate limiting requests.' }, 429)
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitFalJob(submitArgs)).rejects.toThrow(
      'fal is rate limiting requests.'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['URL-encoded', encodeURIComponent(apiKey)],
    [
      'JSON-escaped',
      JSON.stringify('id:"secret\\value').slice(1, -1),
      'id:"secret\\value',
    ],
  ] as ReadonlyArray<readonly [string, string, string?]>)('redacts a %s credential echo from route errors', async (_case, echo, key = apiKey) => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: `Provider exposed ${echo}` }, 400)
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await submitFalJob({ ...submitArgs, apiKey: key }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('fal could not complete that request. Please try again.');
    expect(String(error)).not.toContain(echo);
  });

  it('bounds an otherwise safe route error message', async () => {
    const routeMessage = `Safe prefix ${'x'.repeat(2_000)}`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: routeMessage }, 400))
    );

    const error = await submitFalJob(submitArgs).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('fal could not complete that request. Please try again.');
    expect(String(error)).not.toContain(routeMessage);
  });

  it('posts status fields and validates the returned task shape and request ID', async () => {
    const task = successTask({ state: 'running', resultUrl: undefined, mimeType: undefined });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, task }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getFalJobStatus(taskArgs)).resolves.toEqual(task);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/fal/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'status', ...taskArgs }),
    });
  });

  it('accepts omitted video MIME metadata but rejects a supplied non-video MIME', async () => {
    const videoArgs = {
      ...taskArgs,
      modelId: 'veo-3-1-fast',
      mediaType: 'video' as const,
    };
    const resultUrl = 'https://v3.fal.media/output.mp4';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        task: successTask({ resultUrl, mimeType: undefined }),
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        task: successTask({ resultUrl, mimeType: 'image/png' }),
      }));
    vi.stubGlobal('fetch', fetchMock);

    const taskWithoutMime = await getFalJobStatus(videoArgs);
    expect(taskWithoutMime).toMatchObject({
      state: 'success',
      resultUrl,
    });
    expect(taskWithoutMime).not.toHaveProperty('mimeType');
    await expect(getFalJobStatus(videoArgs)).rejects.toThrow(
      'fal did not return a valid task status.'
    );
  });

  it.each(['short', 'request/id/is/not/allowed', 'r'.repeat(129)])(
    'rejects invalid outgoing request ID %s before status or cancel fetch',
    async (invalidRequestId) => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          task: successTask({ requestId: invalidRequestId }),
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      const invalidArgs = { ...taskArgs, requestId: invalidRequestId };

      const statusError = await getFalJobStatus(invalidArgs).catch((caught: unknown) => caught);
      const cancelError = await cancelFalJob(invalidArgs).catch((caught: unknown) => caught);

      expect(statusError).toEqual(expect.objectContaining({ message: 'fal request ID is invalid.' }));
      expect(cancelError).toEqual(expect.objectContaining({ message: 'fal request ID is invalid.' }));
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, null, 123, {}, []])(
    'rejects non-string outgoing request ID %j before status or cancel fetch',
    async (invalidRequestId) => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
      vi.stubGlobal('fetch', fetchMock);
      const invalidArgs = {
        ...taskArgs,
        requestId: invalidRequestId as unknown as string,
      };

      const statusError = await getFalJobStatus(invalidArgs).catch((caught: unknown) => caught);
      const cancelError = await cancelFalJob(invalidArgs).catch((caught: unknown) => caught);

      expect(statusError).toEqual(expect.objectContaining({ message: 'fal request ID is invalid.' }));
      expect(cancelError).toEqual(expect.objectContaining({ message: 'fal request ID is invalid.' }));
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    { requestId, state: 'unknown', logs: [] },
    { requestId: 'req_different1', state: 'queued', logs: [] },
    { requestId, state: 'queued', logs: [42] },
    { requestId, state: 'queued', logs: [], resultUrl: 42 },
    { requestId, state: 'success', logs: [] },
    { requestId, state: 'success', logs: [], resultUrl: 'javascript:alert(1)' },
  ])('rejects malformed status tasks: %j', async (task) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, task }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getFalJobStatus(taskArgs)).rejects.toThrow(
      'fal did not return a valid task status.'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('posts cancel fields, validates success, and does not retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(cancelFalJob(taskArgs)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/fal/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'cancel', ...taskArgs }),
    });
  });

  it('rejects a malformed cancel response without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: 'yes' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(cancelFalJob(taskArgs)).rejects.toThrow(
      'fal did not confirm the cancellation.'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('runFalImage', () => {
  it('aborts a hung submit at the overall 15-minute deadline without resubmitting or cancelling', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => pendingUntilAborted(init));
    vi.stubGlobal('fetch', fetchMock);

    const run = runFalImage({
      apiKey,
      prompt: submitArgs.prompt,
      dataUrls: [],
      values: submitArgs.values,
    });
    const outcome = run.catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(FAL_JOB_TIMEOUT_MS + 1);
    expect(await outcome).toEqual(
      expect.objectContaining({ message: 'fal image generation timed out after 15 minutes.' })
    );

    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    expect(signal?.aborted).toBe(true);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('aborts a hung status request at the overall deadline without resubmitting or cancelling', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.operation === 'submit'
        ? Promise.resolve(jsonResponse({ success: true, requestId }))
        : pendingUntilAborted(init);
    });
    vi.stubGlobal('fetch', fetchMock);

    const run = runFalImage({
      apiKey,
      prompt: submitArgs.prompt,
      dataUrls: [],
      values: submitArgs.values,
    });
    const outcome = run.catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(FAL_JOB_TIMEOUT_MS + 1);
    expect(await outcome).toEqual(
      expect.objectContaining({ message: 'fal image generation timed out after 15 minutes.' })
    );

    const signal = (fetchMock.mock.calls[1][1] as RequestInit).signal;
    expect(signal?.aborted).toBe(true);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('maps caller abort to a fixed safe error and only aborts local HTTP', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.operation === 'submit'
        ? Promise.resolve(jsonResponse({ success: true, requestId }))
        : pendingUntilAborted(init, controller.signal);
    });
    vi.stubGlobal('fetch', fetchMock);

    const run = runFalImage({
      apiKey,
      prompt: submitArgs.prompt,
      dataUrls: [],
      values: submitArgs.values,
      signal: controller.signal,
    });
    const outcome = run.catch((caught: unknown) => caught);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error(`navigation leaked ${apiKey}`));
    expect(await outcome).toEqual(
      expect.objectContaining({ message: 'fal image generation was aborted.' })
    );

    expect((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).signal?.aborted).toBe(true);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('runs text mode without uploading and does not mutate caller-owned inputs', async () => {
    const dataUrls: string[] = [];
    const values = { ...submitArgs.values };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/fal/queue');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.operation === 'submit') return jsonResponse({ success: true, requestId });
      return jsonResponse({ success: true, task: successTask() });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls, values },
        {
          now: vi.fn().mockReturnValueOnce(0).mockReturnValue(1_000),
          sleep: vi.fn().mockResolvedValue(undefined),
        }
      )
    ).resolves.toEqual({ url: 'https://v3.fal.media/image.png', mimeType: 'image/png' });

    expect(queueBodies(fetchMock)[0]).toEqual({ operation: 'submit', ...submitArgs });
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/fal/upload')).toBe(false);
    expect(dataUrls).toEqual([]);
    expect(values).toEqual(submitArgs.values);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('converts a supported image data URL, uploads once, and submits image mode once', async () => {
    const dataUrl = 'data:image/webp;charset=utf-8;base64,c291cmNl';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === dataUrl) {
        return imageResponse(validImageSignatures[2][2], 'image/webp;charset=utf-8');
      }
      if (url === '/api/fal/upload') {
        const form = init?.body as FormData;
        const file = form.get('file') as File;
        expect(file).toEqual(expect.objectContaining({ name: 'reference-1.webp', type: 'image/webp' }));
        return jsonResponse({ success: true, url: 'https://fal.media/reference.webp' });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.operation === 'submit') return jsonResponse({ success: true, requestId });
      return jsonResponse({ success: true, task: successTask() });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [dataUrl], values: submitArgs.values },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).resolves.toEqual({ url: 'https://v3.fal.media/image.png', mimeType: 'image/png' });

    const submit = queueBodies(fetchMock).find((body) => body.operation === 'submit');
    expect(submit).toEqual({
      operation: 'submit',
      ...submitArgs,
      inputMode: 'image',
      uploadUrls: ['https://fal.media/reference.webp'],
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/fal/upload')).toHaveLength(1);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('polls queued and running tasks with bounded delays before success', async () => {
    const tasks = [
      successTask({ state: 'queued', resultUrl: undefined, mimeType: undefined }),
      successTask({ state: 'running', resultUrl: undefined, mimeType: undefined }),
      successTask(),
    ];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.operation === 'submit'
        ? jsonResponse({ success: true, requestId })
        : jsonResponse({ success: true, task: tasks.shift() });
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [], values: submitArgs.values },
        { now: () => 0, sleep }
      )
    ).resolves.toEqual({ url: 'https://v3.fal.media/image.png', mimeType: 'image/png' });

    expect(sleep).toHaveBeenNthCalledWith(1, 2_500);
    expect(sleep).toHaveBeenNthCalledWith(2, 5_000);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it.each([
    [successTask({ state: 'fail', error: 'fal rejected this prompt.', resultUrl: undefined }), 'fal rejected this prompt.'],
    [successTask({ state: 'cancelled', resultUrl: undefined }), 'fal image generation was cancelled.'],
    [successTask({ state: 'timed_out', resultUrl: undefined }), 'fal image generation timed out.'],
  ] as const)('throws a stable terminal task error for %s', async (task, message) => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.operation === 'submit'
        ? jsonResponse({ success: true, requestId })
        : jsonResponse({ success: true, task });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [], values: submitArgs.values },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toThrow(message);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it.each(unsafeFalUrls)('never returns a successful image URL with %s', async (_case, url) => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.operation === 'submit'
        ? jsonResponse({ success: true, requestId })
        : jsonResponse({ success: true, task: successTask({ resultUrl: url }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [], values: submitArgs.values },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toThrow('fal did not return a valid task status.');
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('surfaces post-submit transport failures safely without resubmitting or cancelling', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.operation === 'submit') return jsonResponse({ success: true, requestId });
      throw new TypeError(`network error exposed ${apiKey}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const error = await runFalImage(
      { apiKey, prompt: submitArgs.prompt, dataUrls: [], values: submitArgs.values },
      { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(apiKey);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('stops at 15 minutes even when injected time does not advance', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.operation === 'submit'
        ? jsonResponse({ success: true, requestId })
        : jsonResponse({
            success: true,
            task: successTask({ state: 'queued', resultUrl: undefined, mimeType: undefined }),
          });
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [], values: submitArgs.values },
        { now: () => 0, sleep }
      )
    ).rejects.toThrow('fal image generation timed out after 15 minutes.');

    expect(sleep.mock.calls.reduce((total, [delay]) => total + delay, 0)).toBe(
      FAL_JOB_TIMEOUT_MS
    );
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('stops at 15 minutes for a frozen high-magnitude injected clock', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.operation === 'submit'
        ? jsonResponse({ success: true, requestId })
        : jsonResponse({
            success: true,
            task: successTask({ state: 'queued', resultUrl: undefined, mimeType: undefined }),
          });
    });
    let sleepCalls = 0;
    const sleep = vi.fn(async () => {
      sleepCalls += 1;
      if (sleepCalls > 100) throw new Error('poll loop guard exceeded');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [], values: submitArgs.values },
        { now: () => Number.MAX_VALUE, sleep }
      )
    ).rejects.toThrow('fal image generation timed out after 15 minutes.');

    expect(sleepCalls).toBeLessThanOrEqual(100);
    expectOneSubmitAndNoCancel(fetchMock);
  });

  it('rejects unsupported image data URLs before upload', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        {
          apiKey,
          prompt: submitArgs.prompt,
          dataUrls: ['data:image/svg+xml;base64,PHN2Zy8+'],
          values: submitArgs.values,
        },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toThrow('Reference image 1 must be a valid PNG, JPEG, WebP, or AVIF data URL.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects more than 14 references before conversion without mutating caller data', async () => {
    const dataUrls = Array.from(
      { length: 15 },
      (_, index) => `data:image/png;base64,reference-${index}`
    );
    const original = [...dataUrls];
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls, values: submitArgs.values },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toThrow('fal accepts at most 14 reference images.');

    expect(dataUrls).toEqual(original);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects random bytes labelled as PNG before upload or submit', async () => {
    const dataUrl = 'data:image/png;base64,bm90LWEtcG5n';
    const fetchMock = vi.fn(async (url: string) => {
      if (url === dataUrl) return imageResponse([1, 2, 3, 4, 5, 6, 7, 8], 'image/png');
      throw new Error('unexpected downstream request');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [dataUrl], values: submitArgs.values },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toThrow('Reference image 1 does not match its declared image type.');

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects MIME and magic-byte mismatches before upload or submit', async () => {
    const dataUrl = 'data:image/png;base64,/9j/4A==';
    const fetchMock = vi.fn(async (url: string) => {
      if (url === dataUrl) return imageResponse(validImageSignatures[1][2], 'image/jpeg');
      throw new Error('unexpected downstream request');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [dataUrl], values: submitArgs.values },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toThrow('Reference image 1 does not match its declared image type.');

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a decoded reference larger than 20 MiB before upload or submit', async () => {
    const dataUrl = 'data:image/png;base64,oversized-after-decode';
    const oversized = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], {
      type: 'image/png',
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === dataUrl) return { blob: async () => oversized } as Response;
      throw new Error('unexpected downstream request');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [dataUrl], values: submitArgs.values },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toThrow('Reference image 1 is larger than 20 MiB.');

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects an obviously oversized base64 data URL before decoding', async () => {
    const encodedLimit = Math.ceil((20 * 1024 * 1024) / 3) * 4;
    const dataUrl = `data:image/png;base64,${'A'.repeat(encodedLimit + 1)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runFalImage(
        { apiKey, prompt: submitArgs.prompt, dataUrls: [dataUrl], values: submitArgs.values },
        { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
      )
    ).rejects.toThrow('Reference image 1 is larger than 20 MiB.');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(validImageSignatures)(
    'accepts valid minimal %s bytes and uses the route-compatible .%s extension',
    async (mimeType, extension, bytes) => {
      const dataUrl = `data:${mimeType};base64,valid-signature`;
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === dataUrl) return imageResponse(bytes, mimeType);
        if (url === '/api/fal/upload') {
          const file = (init?.body as FormData).get('file') as File;
          expect(file).toEqual(
            expect.objectContaining({ name: `reference-1.${extension}`, type: mimeType })
          );
          return jsonResponse({ success: true, url: `https://fal.media/reference.${extension}` });
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return body.operation === 'submit'
          ? jsonResponse({ success: true, requestId })
          : jsonResponse({ success: true, task: successTask() });
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        runFalImage(
          { apiKey, prompt: submitArgs.prompt, dataUrls: [dataUrl], values: submitArgs.values },
          { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
        )
      ).resolves.toEqual({ url: 'https://v3.fal.media/image.png', mimeType: 'image/png' });
    }
  );

  it('converts and uploads multiple references sequentially', async () => {
    const dataUrls = ['data:image/png;base64,first', 'data:image/png;base64,second'];
    let conversionsInFlight = 0;
    let uploadsInFlight = 0;
    let maxConversions = 0;
    let maxUploads = 0;
    let uploadIndex = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (dataUrls.includes(url)) {
        conversionsInFlight += 1;
        maxConversions = Math.max(maxConversions, conversionsInFlight);
        await Promise.resolve();
        conversionsInFlight -= 1;
        return imageResponse(validImageSignatures[0][2], 'image/png');
      }
      if (url === '/api/fal/upload') {
        uploadsInFlight += 1;
        maxUploads = Math.max(maxUploads, uploadsInFlight);
        await Promise.resolve();
        uploadsInFlight -= 1;
        uploadIndex += 1;
        return jsonResponse({ success: true, url: `https://fal.media/reference-${uploadIndex}.png` });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.operation === 'submit'
        ? jsonResponse({ success: true, requestId })
        : jsonResponse({ success: true, task: successTask() });
    });
    vi.stubGlobal('fetch', fetchMock);

    await runFalImage(
      { apiKey, prompt: submitArgs.prompt, dataUrls, values: submitArgs.values },
      { now: () => 0, sleep: vi.fn().mockResolvedValue(undefined) }
    );

    expect(maxConversions).toBe(1);
    expect(maxUploads).toBe(1);
    expectOneSubmitAndNoCancel(fetchMock);
  });
});
