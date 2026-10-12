// tests/providers/seedance-draft.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/providers/video/route';
import { runwareCreateVideo, runwarePollVideo } from '@/lib/providers/runware';
import { findModel } from '@/lib/providers/catalog';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { estimateCloudJob } from '@/lib/spend/estimate';
import { SEEDANCE_DRAFT_EXPIRED, SEEDANCE_FINALIZE_PRICE_NOTE, seedanceCatalogFigure } from '@/lib/providers/seedance-draft';
import type { CloudJobRequest } from '@/lib/account/contracts';

const model = 'bytedance:seedance@2.5';
afterEach(() => vi.unstubAllGlobals());

function tasks(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as Array<Record<string, unknown>>;
}

describe('Seedance draft and finalize requests', () => {
  it('sends a 480p text draft and reads the draft id back', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{}] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ videoURL: 'https://im.runware.ai/draft.mp4', cost: 0.51, outputs: { draftId: 'draft-1' } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const { taskId } = await runwareCreateVideo({
      apiKey: 'rw', model, prompt: 'a lighthouse', draft: true, width: 854, height: 480, durationSeconds: 5,
    });
    const [task] = tasks(fetchMock);
    expect(task).toMatchObject({ positivePrompt: 'a lighthouse', width: 854, height: 480, duration: 5, settings: { draft: true } });
    expect(task.resolution).toBeUndefined();
    const polled = await runwarePollVideo({ apiKey: 'rw', taskId });
    expect(polled).toMatchObject({ state: 'success', draftId: 'draft-1', cost: 0.51 });
  });

  it('sends an edit draft at 480p with duration auto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{}] }) });
    vi.stubGlobal('fetch', fetchMock);
    await runwareCreateVideo({
      apiKey: 'rw', model, prompt: 'replace the sky', inputMode: 'edit', sourceVideo: 'clip-1', resolution: '480p', draft: true,
    });
    expect(tasks(fetchMock)[0]).toMatchObject({
      positivePrompt: 'replace the sky', duration: 'auto', resolution: '480p',
      inputs: { video: 'clip-1' }, settings: { operation: 'edit', draft: true },
    });
    expect(tasks(fetchMock)[0]).not.toHaveProperty('width');
  });

  it('finalizes with the draft id and 1080p, and rejects a resent prompt or media', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{}] }) });
    vi.stubGlobal('fetch', fetchMock);
    await runwareCreateVideo({ apiKey: 'rw', model, prompt: '', draftId: 'draft-1', resolution: '1080p' });
    const [task] = tasks(fetchMock);
    expect(task).toEqual({
      taskType: 'videoInference', taskUUID: task.taskUUID, model, resolution: '1080p',
      inputs: { draftId: 'draft-1' }, deliveryMethod: 'async', includeCost: true, outputFormat: 'MP4',
    });
    expect(task).not.toHaveProperty('positivePrompt');
    expect(task).not.toHaveProperty('settings');
    expect(task).not.toHaveProperty('duration');
    await expect(runwareCreateVideo({ apiKey: 'rw', model, prompt: 'again', draftId: 'draft-1' })).rejects.toThrow(/cannot resend/);
    await expect(runwareCreateVideo({ apiKey: 'rw', model, prompt: '', draftId: 'draft-1', sourceVideo: 'clip' })).rejects.toThrow(/cannot resend/);
    await expect(runwareCreateVideo({ apiKey: 'rw', model, prompt: '', draftId: 'draft-1', images: ['data:image/png;base64,eA=='] })).rejects.toThrow(/cannot resend/);
  });

  it('says when a draft id is invalid or expired', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ errors: [{ parameter: 'inputs.draftId', message: 'The draft id is invalid.' }] }),
    }));
    await expect(runwareCreateVideo({ apiKey: 'rw', model, prompt: '', draftId: 'gone' })).rejects.toThrow(SEEDANCE_DRAFT_EXPIRED);
  });

  it('rejects prompt and media on the browser finalize route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
    vi.stubGlobal('fetch', fetchMock);
    const send = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/providers/video', { method: 'POST', body: JSON.stringify({ provider: 'runware', apiKey: 'test-key', model, ...body }) }));
    expect((await send({ operation: 'finalize', draftId: 'draft-1', prompt: 'nope' })).status).toBe(400);
    expect((await send({ operation: 'finalize', draftId: 'draft-1', images: ['data:image/png;base64,eA=='] })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await send({ operation: 'finalize', draftId: 'draft-1' })).status).toBe(200);
    expect(tasks(fetchMock)[0]).toMatchObject({ inputs: { draftId: 'draft-1' }, resolution: '1080p' });
    expect(tasks(fetchMock)[0]).not.toHaveProperty('positivePrompt');
  });
});

describe('Seedance draft pricing', () => {
  const request = (values: CloudJobRequest['values'], inputMode: CloudJobRequest['inputMode'] = 'text'): CloudJobRequest => ({
    provider: 'runware', modelId: model, mediaType: 'video', inputMode, prompt: 'A lighthouse at dusk', values, referenceIds: [],
  });

  it('prices a draft at the documented 480p rate and a finalize as an estimate', () => {
    const draft = seedanceCatalogFigure(request({ draft: true, size: '480p · 16:9', durationSeconds: 5 }), findModel('runware', model));
    expect(draft).toMatchObject({ costUsd: 0.51, confidence: 'estimated' });
    expect(draft?.note).toMatch(/480p/);
    const finalize = seedanceCatalogFigure(request({ finalize: true, draftId: 'draft-1', durationSeconds: 5 }), findModel('runware', model));
    expect(finalize).toMatchObject({ costUsd: 3.07, confidence: 'estimated' });
    expect(finalize?.note).toBe(SEEDANCE_FINALIZE_PRICE_NOTE);
    const editFinalize = seedanceCatalogFigure(request({ finalize: true, draftId: 'draft-1', durationSeconds: 1 }, 'edit'), findModel('runware', model));
    expect(editFinalize?.costUsd).toBeCloseTo(0.734, 6);
  });

  it('uses a reported cost as exact and leaves other Runware jobs unknown', () => {
    const exact = buildAccountSpendEntry({
      jobId: 'job', request: request({ draft: true, size: '480p · 16:9', durationSeconds: 5 }), result: { sources: [{}], cost: 0.4 }, at: 1,
    });
    expect(exact).toMatchObject({ costUsd: 0.4, confidence: 'exact', source: 'response' });
    const estimated = buildAccountSpendEntry({
      jobId: 'job', request: request({ finalize: true, draftId: 'draft-1', durationSeconds: 5 }), result: { sources: [{}] }, at: 1,
    });
    expect(estimated).toMatchObject({ costUsd: 3.07, confidence: 'estimated' });
    const plain = estimateCloudJob(request({ size: '720p · 16:9', durationSeconds: 5 }));
    expect(plain).toMatchObject({ costUsd: null, confidence: 'unknown' });
  });
});
