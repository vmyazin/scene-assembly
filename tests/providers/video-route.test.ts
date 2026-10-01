// tests/providers/video-route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/providers/video/route';

/** The route reads JSON off a Request; NextRequest is compatible for this. */
function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/providers/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never
  );
}

function mockFetch(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/providers/video', () => {
  it('routes PiAPI audio, aspect and resolution into Veo Fast', async () => {
    const mock = mockFetch({code:200,data:{task_id:'piapi-video'}});
    const response = await post({provider:'piapi',apiKey:'test-only',model:'veo-3.1-fast',prompt:'A slow pan',inputMode:'text',durationSeconds:6,size:'1080p',aspectRatio:'9:16',audio:true});
    expect(response.status).toBe(200);
    expect(JSON.parse(mock.mock.calls[0][1].body)).toMatchObject({task_type:'veo3.1-video-fast',input:{duration:'6s',resolution:'1080p',aspect_ratio:'9:16',generate_audio:true}});
  });
  it('rejects an invalid PiAPI audio value before payment', async () => {
    const mock = mockFetch({});
    expect((await post({provider:'piapi',apiKey:'test-only',prompt:'A slow pan',audio:'true'})).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
  it('rejects a provider it does not serve before touching the network', async () => {
    const fetchMock = mockFetch({});

    const response = await post({ provider: 'midjourney', apiKey: 'k', prompt: 'x' });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a key and a prompt', async () => {
    expect((await post({ provider: 'runware', prompt: 'x' })).status).toBe(400);
    expect((await post({ provider: 'runware', apiKey: 'k', prompt: '   ' })).status).toBe(400);
  });

  it('falls back to the provider default when the model is unknown', async () => {
    const fetchMock = mockFetch({ data: [{}] });

    const response = await post({
      provider: 'runware',
      apiKey: 'rw',
      prompt: 'a slow pan',
      model: 'not-a-real-model',
    });

    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(task.model).toBe('lightricks:ltx@2.5-fast');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it('snaps the clip length to one the model accepts', async () => {
    const fetchMock = mockFetch({ data: [{}] });

    await post({
      provider: 'runware',
      apiKey: 'rw',
      prompt: 'a slow pan',
      model: 'lightricks:ltx@2.5-fast',
      durationSeconds: 5,
    });

    // LTX-2 Fast takes 6, 8 or 10 and rejects 5 outright.
    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(task.duration).toBe(6);
  });

  it('sends no duration for a model that has no seconds control', async () => {
    const fetchMock = mockFetch({ data: { id: 'pred-1' } });

    await post({
      provider: 'atlas',
      apiKey: 'at',
      prompt: 'a slow pan',
      model: 'ltx-2.3-quality/text-to-video',
      durationSeconds: 6,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty('duration');
  });

  it('rejects an unsupported Veo 3.1 Lite duration, size, or aspect before payment', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    const base = { provider: 'runware', apiKey: 'rw', prompt: 'a lantern', model: 'google:veo@3.1-lite', inputMode: 'text' };

    expect((await post({ ...base, durationSeconds: 5 })).status).toBe(400);
    expect((await post({ ...base, size: '4k · 16:9' })).status).toBe(400);
    expect((await post({ ...base, aspectRatio: '1:1' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the Veo 3.1 Lite capacity message once, without a retryable status', async () => {
    const fetchMock = mockFetch(
      { errors: [{ code: 'modelUnavailable', message: 'Model capacity is limited.' }] },
      { ok: false, status: 503 }
    );

    const response = await post({
      provider: 'runware',
      apiKey: 'rw',
      prompt: 'a lantern',
      model: 'google:veo@3.1-lite',
      inputMode: 'text',
      durationSeconds: 4,
      size: '720p · 16:9',
      audio: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/no free capacity on Runware/),
    });
  });

  it('passes a provider failure through with its status', async () => {
    mockFetch({ errors: [{ message: 'insufficient credits' }] }, { ok: false, status: 402 });

    const response = await post({ provider: 'runware', apiKey: 'rw', prompt: 'x' });

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('out of credits'),
    });
  });

  it('reports task status for a running job', async () => {
    mockFetch({ data: [{ status: 'processing', progress: 20 }] });

    const response = await post({
      provider: 'runware',
      apiKey: 'rw',
      operation: 'status',
      taskId: 'uuid-9',
    });

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      task: { state: 'running', progress: 0.2 },
    });
  });
});
