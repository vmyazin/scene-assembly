import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/providers/video/route';
import { findModel, modelsFor, resolveDuration } from '@/lib/providers/catalog';
import { runwareCreateVideo } from '@/lib/providers/runware';

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

function sentTask(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string)[0];
}

afterEach(() => vi.unstubAllGlobals());

describe('WAN 3 character-reference catalog contract', () => {
  it('publishes reference capability, range duration, and all resolution presets', () => {
    const wan = findModel('runware', 'alibaba:wan@3.0');
    expect(wan).toBeDefined();
    if (!wan) throw new Error('WAN 3 catalog entry is missing');
    expect(wan).toMatchObject({ id: 'alibaba:wan@3.0', label: 'Wan 3.0', modes: expect.arrayContaining(['reference']) });
    expect(wan.videoInputs?.reference).toMatchObject({
      field: 'referenceImages',
      maxImages: 10,
      clientMaxImages: 5,
      promptSyntax: 'image-index',
    });
    expect(wan.duration).toMatchObject({ type: 'range', min: 2, max: 30, default: 6 });
    expect(wan.sizes?.map((size: { label: string }) => size.label)).toEqual(
      expect.arrayContaining(['480p', '720p', '1080p'])
    );
    expect(modelsFor('runware', 'video').filter((model) => model.modes.includes('reference'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'alibaba:wan@3.0' })])
    );
  });

  it.each([
    [undefined, 6],
    [1, 2],
    [2.4, 2],
    [6.8, 7],
    [31, 30],
  ])('resolves WAN duration %s to %s', (requested, expected) => {
    expect(resolveDuration('runware', 'alibaba:wan@3.0', requested as number | undefined)).toBe(expected);
  });
});

describe('reference mode route and Runware transport', () => {
  it('sends trusted referenceImages for semantic reference mode', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    await runwareCreateVideo({
      apiKey: 'rw-key',
      model: 'alibaba:wan@3.0',
      prompt: 'A character walks',
      images: ['data:image/png;base64,A', 'data:image/png;base64,B'],
      inputMode: 'reference',
      inputField: 'referenceImages',
      durationSeconds: 6,
      resolution: '720p',
    });

    const task = sentTask(fetchMock);
    expect(task.inputs).toEqual({
      referenceImages: ['data:image/png;base64,A', 'data:image/png;base64,B'],
    });
    expect(task).toMatchObject({ resolution: '720p' });
    expect(task).not.toHaveProperty('width');
    expect(task).not.toHaveProperty('height');
  });

  it('keeps image/frame requests on frameImages', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    await runwareCreateVideo({
      apiKey: 'rw-key',
      model: 'lightricks:ltx@2.5-fast',
      prompt: 'A transition',
      images: ['data:image/png;base64,A'],
      inputMode: 'image',
      durationSeconds: 6,
    });
    expect(sentTask(fetchMock).inputs).toEqual({ frameImages: ['data:image/png;base64,A'] });
  });

  it('rejects unsupported mode/model and too many references before network access', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    const common = { provider: 'runware', apiKey: 'rw-key', prompt: 'A clip' };

    expect((await post({ ...common, model: 'lightricks:ltx@2.5-fast', inputMode: 'reference', images: ['data:image/png;base64,A'] })).status).toBe(400);
    expect((await post({ ...common, model: 'alibaba:wan@3.0', inputMode: 'reference', images: Array.from({ length: 11 }, (_, index) => `data:image/png;base64,${index}`) })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not trust an arbitrary browser input field when selecting Runware inputs', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    const response = await post({
      provider: 'runware',
      apiKey: 'rw-key',
      model: 'lightricks:ltx@2.5-fast',
      prompt: 'A clip',
      inputMode: 'image',
      inputField: 'referenceImages',
      images: ['data:image/png;base64,A'],
    });

    expect(response.status).toBe(200);
    expect(sentTask(fetchMock).inputs).toEqual({ frameImages: ['data:image/png;base64,A'] });
  });

  it('sends Seedance reference video and audio as uploaded ids, including on a draft', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    await runwareCreateVideo({
      apiKey: 'rw-key',
      model: 'bytedance:seedance@2.5',
      prompt: 'Follow @Video1 and @Audio1',
      inputMode: 'text',
      referenceVideos: ['11111111-1111-1111-1111-111111111111'],
      referenceAudios: ['22222222-2222-2222-2222-222222222222'],
      durationSeconds: 5,
      width: 854,
      height: 480,
      draft: true,
    });
    expect(sentTask(fetchMock).inputs).toEqual({
      referenceVideos: ['11111111-1111-1111-1111-111111111111'],
      referenceAudios: ['22222222-2222-2222-2222-222222222222'],
    });
    expect(sentTask(fetchMock).settings).toEqual({ draft: true });
  });

  it('refuses to resend reference clips when finalizing a draft', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    await expect(runwareCreateVideo({
      apiKey: 'rw-key',
      model: 'bytedance:seedance@2.5',
      prompt: '',
      draftId: 'draft-1',
      resolution: '1080p',
      referenceVideos: ['11111111-1111-1111-1111-111111111111'],
    })).rejects.toThrow(/cannot resend/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts Seedance text with uploaded clips and rejects them on Wan', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    const clip = '11111111-1111-1111-1111-111111111111';
    const accepted = await post({
      provider: 'runware',
      apiKey: 'rw-key',
      model: 'bytedance:seedance@2.5',
      prompt: 'Follow @Video1',
      inputMode: 'text',
      referenceVideos: [clip],
      durationSeconds: 5,
      size: '480p · 16:9',
    });
    expect(accepted.status).toBe(200);
    expect(sentTask(fetchMock).inputs).toEqual({ referenceVideos: [clip] });

    const wan = await post({
      provider: 'runware',
      apiKey: 'rw-key',
      model: 'alibaba:wan@3.0',
      prompt: 'A walk',
      inputMode: 'reference',
      images: ['data:image/png;base64,A'],
      referenceVideos: [clip],
    });
    expect(wan.status).toBe(400);
    expect(await wan.json()).toMatchObject({ error: expect.stringMatching(/does not take reference video or audio/) });
  });

  it('resolves a WAN reference request end to end through the route', async () => {
    const fetchMock = mockFetch({ data: [{}] });
    const response = await post({
      provider: 'runware',
      apiKey: 'rw-key',
      model: 'alibaba:wan@3.0',
      prompt: 'Image 1 walks through a night market',
      inputMode: 'reference',
      inputField: 'frameImages',
      images: ['data:image/png;base64,A'],
      durationSeconds: 6,
      size: '720p',
    });

    expect(response.status).toBe(200);
    expect(sentTask(fetchMock)).toMatchObject({
      model: 'alibaba:wan@3.0',
      duration: 6,
      resolution: '720p',
      inputs: { referenceImages: ['data:image/png;base64,A'] },
    });
  });
});
