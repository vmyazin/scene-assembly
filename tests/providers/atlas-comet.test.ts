import { afterEach, describe, expect, it, vi } from 'vitest';

import { atlasCreateVideo, atlasGenerateImage, atlasPollVideo } from '@/lib/providers/atlas';
import { cometCreateVideo, cometGenerateImage, cometPollVideo } from '@/lib/providers/comet';
import { resolveModel } from '@/lib/providers/catalog';

/** Queues one response per call so a submit-then-poll pair can be scripted. */
function mockFetchSequence(responses: Array<{ payload: unknown; ok?: boolean; status?: number }>) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.payload,
    });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const noSleep = async () => {};

afterEach(() => vi.unstubAllGlobals());

describe('atlas cloud', () => {
  it('submits, then polls the prediction until it succeeds', async () => {
    const fetchMock = mockFetchSequence([
      { payload: { data: { id: 'pred-1' } } },
      { payload: { id: 'pred-1', status: 'processing' } },
      { payload: { id: 'pred-1', status: 'succeeded', output: ['https://cdn.atlas/a.png'] } },
    ]);

    const result = await atlasGenerateImage(
      {
        apiKey: 'at-key',
        model: 'black-forest-labs/flux-schnell',
        prompt: 'a lighthouse',
        aspectRatio: '9:16',
      },
      noSleep
    );

    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(submitUrl).toBe('https://api.atlascloud.ai/api/v1/model/generateImage');
    const body = JSON.parse(submitInit.body as string);
    // Atlas writes sizes with a star, not an x.
    expect(body).toMatchObject({
      model: 'black-forest-labs/flux-schnell',
      prompt: 'a lighthouse',
      size: '768*1344',
      num_images: 1,
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.atlascloud.ai/api/v1/model/prediction/pred-1');
    expect(result).toEqual({ url: 'https://cdn.atlas/a.png' });
  });

  /**
   * The Developer editions are the reason `imageBody` dispatches per model.
   * Atlas validates against the upstream schema and drops a name that schema
   * does not carry **without erroring**, so a body assembled in the older
   * dialect would return a plausible image at the wrong size and the wrong
   * shape. These assert the names each endpoint publishes, not just that a
   * request went out.
   */
  describe('developer editions speak their own dialect', () => {
    async function submitImage(request: Parameters<typeof atlasGenerateImage>[0]) {
      const fetchMock = mockFetchSequence([
        { payload: { data: { id: 'pred-dev' } } },
        { payload: { id: 'pred-dev', status: 'succeeded', output: ['https://cdn.atlas/dev.png'] } },
      ]);
      await atlasGenerateImage(request, noSleep);
      return JSON.parse(fetchMock.mock.calls[0][1].body as string);
    }

    it('sends Nano Banana 2 a ratio and a lowercase tier, and no size at all', async () => {
      const body = await submitImage({
        apiKey: 'at-key',
        model: 'google/nano-banana-2/text-to-image-developer',
        prompt: 'a lighthouse',
        aspectRatio: '16:9',
        resolution: '4K',
      });

      expect(body).toEqual({
        model: 'google/nano-banana-2/text-to-image-developer',
        prompt: 'a lighthouse',
        aspect_ratio: '16:9',
        // Lowercased through the catalog: Atlas refuses the studio's `4K`.
        resolution: '4k',
      });
      // The two fields every other Atlas image model sends would be ignored here.
      expect(body.size).toBeUndefined();
      expect(body.num_images).toBeUndefined();
    });

    it('holds Nano Banana 2 Lite to the one tier it publishes', async () => {
      const body = await submitImage({
        apiKey: 'at-key',
        model: 'google/nano-banana-2-lite/text-to-image-developer',
        prompt: 'a lighthouse',
        resolution: '4K',
      });

      // Lite lists `1k` alone, so a tier carried over from a bigger model
      // resolves down rather than travelling and being rejected.
      expect(body.resolution).toBe('1k');
    });

    it('sends Nano Banana 2 edits as the images array', async () => {
      const body = await submitImage({
        apiKey: 'at-key',
        model: 'google/nano-banana-2/edit-developer',
        prompt: 'make it dusk',
        images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
      });

      expect(body.images).toEqual(['data:image/png;base64,AAA', 'data:image/png;base64,BBB']);
      expect(body.image).toBeUndefined();
    });

    it("writes GPT Image 2.5's size with an x, from its own enum, with n", async () => {
      const body = await submitImage({
        apiKey: 'at-key',
        model: 'openai/gpt-image-2.5-sunburst-developer/text-to-image',
        prompt: 'a ramen stall',
        aspectRatio: '4:3',
      });

      expect(body).toEqual({
        model: 'openai/gpt-image-2.5-sunburst-developer/text-to-image',
        prompt: 'a ramen stall',
        // An `x`, where every other Atlas image model takes a star.
        size: '1024x768',
        n: 1,
      });
      expect(body.num_images).toBeUndefined();
    });

    it('snaps the shapes GPT Image 2.5 publishes no 1K size for', async () => {
      // 16:9 has no size in the 1K tier, and billing 2K for a 1K choice is the
      // failure the pin exists to prevent — so it lands on the widest 1K shape.
      const body = await submitImage({
        apiKey: 'at-key',
        model: 'openai/gpt-image-2.5-flare-developer/text-to-image',
        prompt: 'a ramen stall',
        aspectRatio: '16:9',
      });

      expect(body.size).toBe('1536x1024');
    });

    it('renames every field MiniMax H3 renames', async () => {
      const fetchMock = mockFetchSequence([{ payload: { data: { id: 'vid-h3' } } }]);
      await atlasCreateVideo({
        apiKey: 'at-key',
        model: 'minimax/h3-developer/image-to-video',
        prompt: 'push in slowly',
        images: ['data:image/png;base64,AAA', 'data:image/png;base64,ZZZ'],
        inputField: 'frameImages',
        durationSeconds: 8,
        resolution: '768P',
        aspectRatio: '16:9',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toEqual({
        model: 'minimax/h3-developer/image-to-video',
        prompt: 'push in slowly',
        image: 'data:image/png;base64,AAA',
        // `end_image`, not the `last_image` the Seedance endpoints take.
        end_image: 'data:image/png;base64,ZZZ',
        duration: 8,
        resolution: '768P',
        // `ratio`, not `aspect_ratio`.
        ratio: '16:9',
      });
      expect(body.last_image).toBeUndefined();
      expect(body.aspect_ratio).toBeUndefined();
    });

    it('wraps H3 references as refers objects, with the type named', async () => {
      const fetchMock = mockFetchSequence([{ payload: { data: { id: 'vid-h3r' } } }]);
      await atlasCreateVideo({
        apiKey: 'at-key',
        model: 'minimax/h3-developer/reference-to-video',
        prompt: 'keep her jacket',
        images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
        inputField: 'referenceImages',
        durationSeconds: 8,
        resolution: '480P',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      // `type` is documented as optional because Atlas infers it from the URL
      // extension — which a data URL does not have, so it is always written.
      expect(body.refers).toEqual([
        { url: 'data:image/png;base64,AAA', type: 'image' },
        { url: 'data:image/png;base64,BBB', type: 'image' },
      ]);
      expect(body.reference_images).toBeUndefined();
    });
  });

  it('fails with the prediction logs, which are the only detail Atlas gives', async () => {
    mockFetchSequence([
      { payload: { data: { id: 'pred-2' } } },
      { payload: { id: 'pred-2', status: 'failed', logs: 'content policy violation' } },
    ]);

    await expect(
      atlasGenerateImage(
        { apiKey: 'at-key', model: 'black-forest-labs/flux-schnell', prompt: 'x' },
        noSleep
      )
    ).rejects.toThrow(/content policy violation/);
  });

  it('passes an image-to-video reference as the documented image field', async () => {
    const fetchMock = mockFetchSequence([{ payload: { data: { id: 'pred-3' } } }]);

    const { taskId } = await atlasCreateVideo({
      apiKey: 'at-key',
      model: 'bytedance/seedance-v1-pro-fast/image-to-video',
      prompt: 'push in slowly',
      images: ['data:image/png;base64,AAA'],
      durationSeconds: 5,
      resolution: '720p',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.atlascloud.ai/api/v1/model/generateVideo');
    expect(body).toMatchObject({ image: 'data:image/png;base64,AAA', duration: 5, resolution: '720p' });
    expect(taskId).toBe('pred-3');
  });

  it('names the aspect field the way each Seedance generation does', async () => {
    const fetchMock = mockFetchSequence([
      { payload: { data: { id: 'pred-4' } } },
      { payload: { data: { id: 'pred-5' } } },
    ]);

    await atlasCreateVideo({
      apiKey: 'at-key',
      model: 'bytedance/seedance-v1-pro-fast/image-to-video',
      prompt: 'push in slowly',
      images: ['data:image/png;base64,AAA'],
      inputField: 'frameImages',
      aspectRatio: '16:9',
    });
    await atlasCreateVideo({
      apiKey: 'at-key',
      model: 'bytedance/seedance-2.0-mini/text-to-video',
      prompt: 'a kite over the harbour',
      aspectRatio: '16:9',
    });

    // Seedance v1 takes `aspect_ratio`; 2.0 renamed it to `ratio`, and either
    // model drops the other spelling in silence rather than failing.
    const v1 = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(v1.aspect_ratio).toBe('16:9');
    expect(v1.ratio).toBeUndefined();

    const v2 = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(v2.ratio).toBe('16:9');
    expect(v2.aspect_ratio).toBeUndefined();
  });

  it('keeps the 2.0 spelling of the aspect field for Seedance 2.5', async () => {
    const fetchMock = mockFetchSequence([{ payload: { data: { id: 'pred-4b' } } }]);

    await atlasCreateVideo({
      apiKey: 'at-key',
      model: 'bytedance/seedance-2.5/text-to-video',
      prompt: 'a kite over the harbour',
      aspectRatio: '21:9',
      durationSeconds: 30,
      resolution: '1080p',
    });

    // The v1 spelling would be dropped in silence and the clip would come back
    // in the model's default shape rather than the one that was asked for.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ ratio: '21:9', duration: 30, resolution: '1080p' });
    expect(body.aspect_ratio).toBeUndefined();
  });

  it('bookends a Seedance 2.0 clip with a closing frame when a second still is sent', async () => {
    const fetchMock = mockFetchSequence([{ payload: { data: { id: 'pred-6' } } }]);

    await atlasCreateVideo({
      apiKey: 'at-key',
      model: 'bytedance/seedance-2.0-mini/image-to-video',
      prompt: 'the door opens',
      images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
      inputMode: 'frames',
      inputField: 'frameImages',
      durationSeconds: 6,
      resolution: '720p',
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      image: 'data:image/png;base64,AAA',
      last_image: 'data:image/png;base64,BBB',
      duration: 6,
      resolution: '720p',
    });
  });

  it('sends subject references as the array the reference endpoints take', async () => {
    const fetchMock = mockFetchSequence([{ payload: { data: { id: 'pred-7' } } }]);

    await atlasCreateVideo({
      apiKey: 'at-key',
      model: 'bytedance/seedance-2.0-fast/reference-to-video',
      prompt: 'Image 1 walks through Image 2',
      images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
      inputMode: 'reference',
      inputField: 'referenceImages',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reference_images).toEqual([
      'data:image/png;base64,AAA',
      'data:image/png;base64,BBB',
    ]);
    // The single-frame field would pin the first reference as a first frame.
    expect(body.image).toBeUndefined();
  });

  it('sizes Seedream inside the pixel window it requires', async () => {
    const fetchMock = mockFetchSequence([
      { payload: { data: { id: 'pred-8' } } },
      { payload: { id: 'pred-8', status: 'succeeded', output: ['https://cdn.atlas/b.png'] } },
    ]);

    await atlasGenerateImage(
      {
        apiKey: 'at-key',
        model: 'bytedance/seedream-v5.0-pro/edit',
        prompt: 'make the sign read OPEN',
        images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
        aspectRatio: '16:9',
      },
      noSleep
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // 1344*768 is below Seedream's 1,048,576-pixel floor, so it takes its own.
    expect(body.size).toBe('2048*1152');
    // The editor takes an array, and rejects the singular `image` field.
    expect(body.images).toEqual(['data:image/png;base64,AAA', 'data:image/png;base64,BBB']);
    expect(body.image).toBeUndefined();
  });

  it('drops a carried-over reference for a Seedream text-to-image run', async () => {
    const fetchMock = mockFetchSequence([
      { payload: { data: { id: 'pred-9' } } },
      { payload: { id: 'pred-9', status: 'succeeded', output: ['https://cdn.atlas/c.png'] } },
    ]);

    await atlasGenerateImage(
      {
        apiKey: 'at-key',
        model: 'bytedance/seedream-v5.0-pro/text-to-image',
        prompt: 'a harbour at dawn',
        images: ['data:image/png;base64,AAA'],
        aspectRatio: '1:1',
      },
      noSleep
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.size).toBe('1536*1536');
    expect(body.image).toBeUndefined();
    expect(body.images).toBeUndefined();
  });

  it('maps a queued prediction to a queued task', async () => {
    mockFetchSequence([{ payload: { id: 'pred-3', status: 'queued' } }]);

    expect(await atlasPollVideo({ apiKey: 'at-key', taskId: 'pred-3' })).toMatchObject({
      state: 'queued',
      urls: [],
    });
  });
});

describe('cometapi', () => {
  it('sends the OpenAI image shape and reads base64 when the model returns it', async () => {
    const fetchMock = mockFetchSequence([{ payload: { data: [{ b64_json: 'QUJD' }] } }]);

    const result = await cometGenerateImage({
      apiKey: 'cm-key',
      model: 'gpt-image-2',
      prompt: 'a paper crane',
      aspectRatio: '1:1',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cometapi.com/v1/images/generations');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-image-2',
      prompt: 'a paper crane',
      n: 1,
      size: '1024x1024',
    });
    expect(result).toEqual({ base64: 'QUJD', mimeType: 'image/png' });
  });

  it('falls back to the URL for models that return one', async () => {
    mockFetchSequence([{ payload: { data: [{ url: 'https://cdn.comet/a.png' }] } }]);

    expect(await cometGenerateImage({ apiKey: 'cm-key', model: 'qwen-image', prompt: 'x' })).toEqual({
      url: 'https://cdn.comet/a.png',
    });
  });

  it('creates video as multipart form data, the only shape the route documents', async () => {
    const fetchMock = mockFetchSequence([{ payload: { id: 'vid-1' } }]);

    const { taskId } = await cometCreateVideo({
      apiKey: 'cm-key',
      model: 'seedance-2-5',
      prompt: 'a rotating cube',
      durationSeconds: 4,
      aspectRatio: '16:9',
      images: ['data:image/png;base64,QUJD'],
    });

    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('model')).toBe('seedance-2-5');
    expect(form.get('seconds')).toBe('4');
    expect(form.get('size')).toBe('1280x720');
    expect(form.get('input_reference')).toBeInstanceOf(Blob);
    expect(taskId).toBe('vid-1');
  });

  it('treats both documented terminal failures as errors', async () => {
    mockFetchSequence([
      { payload: { status: 'failed', error: { message: 'provider rejected the task' } } },
      { payload: { status: 'error' } },
    ]);

    expect(await cometPollVideo({ apiKey: 'cm-key', taskId: 'vid-1' })).toMatchObject({
      state: 'error',
      error: 'provider rejected the task',
    });
    expect(await cometPollVideo({ apiKey: 'cm-key', taskId: 'vid-1' })).toMatchObject({ state: 'error' });
  });

  it('reports in-progress work with progress on the app scale', async () => {
    mockFetchSequence([{ payload: { status: 'in_progress', progress: 40 } }]);

    expect(await cometPollVideo({ apiKey: 'cm-key', taskId: 'vid-1' })).toMatchObject({
      state: 'running',
      progress: 0.4,
    });
  });
});

describe('model resolution', () => {
  it('falls back to the provider default when the persisted model is unknown or foreign', () => {
    expect(resolveModel('runware', 'image', 'gpt-image-2')).toBe('runware:z-image@turbo');
    expect(resolveModel('atlas', 'video', undefined)).toBe('ltx-2.3-quality/text-to-video');
    // A model of the wrong kind is as wrong as one that does not exist.
    expect(resolveModel('runware', 'image', 'lightricks:ltx@2.5-fast')).toBe('runware:z-image@turbo');
    expect(resolveModel('comet', 'image', 'qwen-image')).toBe('qwen-image');
  });
});
