// tests/providers/video-edit.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/providers/video/route';
import { runwareCreateVideo } from '@/lib/providers/runware';
import { findModel } from '@/lib/providers/catalog';
import { resolveCatalogRate } from '@/lib/spend/resolve';
import { validateEditVideo, validateEditSource, editSourceSummary, framePinsFor } from '@/lib/providers/video-edit';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { estimateCloudJob } from '@/lib/spend/estimate';
import type { CloudJobRequest } from '@/lib/account/contracts';
import { FAL_VIDEO_MODELS } from '@/lib/fal/catalog';
const source = '989ba605-1449-4e1e-b462-cd83ec9c1a67';
const request = {provider: 'runware', apiKey: 'test-key', model: 'bytedance:seedance@2.5', inputMode: 'edit', sourceVideo: source, prompt: 'Replace the background', size: '720p'};
afterEach(() => vi.unstubAllGlobals());
describe('video editing contract', () => {
  it('sends an explicit edit with inherited timing/shape and optional replacement images', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({data: [{}]})); vi.stubGlobal('fetch', fetch);
    await runwareCreateVideo({apiKey: 'test', model: request.model, inputMode: 'edit', sourceVideo: source, prompt: request.prompt, resolution: '720p', images: ['https://example.test/character.png'], durationSeconds: 10, width: 1920, height: 1080});
    const [task] = JSON.parse(fetch.mock.calls[0][1].body);
    expect(task).toMatchObject({inputs: {video: source, referenceImages: ['https://example.test/character.png']}, settings: {operation: 'edit'}, duration: 'auto', resolution: '720p', includeCost: true});
    expect(task).not.toHaveProperty('width'); expect(task).not.toHaveProperty('height'); expect(task.inputs).not.toHaveProperty('frameImages');
  });
  it('accepts a source without images and rejects invalid edits before calling the provider', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({data:[{}]}))); vi.stubGlobal('fetch', fetch);
    const send = (body: unknown) => POST(new NextRequest('http://localhost/api/providers/video', {method:'POST', body:JSON.stringify(body)}));
    expect((await send(request)).status).toBe(200);
    fetch.mockClear();
    for (const change of [{sourceVideo: undefined}, {sourceVideo: 'https://private.test/a.mp4'}, {provider: 'atlas'}, {model: 'alibaba:wan@3.0'}, {durationSeconds: 6}, {aspectRatio: '16:9'}, {size: '4k'}, {images:Array(6).fill('data:image/png;base64,eA==')}]) expect((await send({...request,...change})).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect((await send({...request, size: '1080p'})).status).toBe(200);
  });
  it('estimates edits at the video-to-video rate instead of the generation rate', () => {
    const model=findModel('runware',request.model);
    expect(resolveCatalogRate(model, 4, 1, {inputMode:'edit',size:'720p'})).toMatchObject({costUsd:1.18,confidence:'estimated'});
    expect(resolveCatalogRate(model, 1, 1, {inputMode:'edit',size:'1080p'}).costUsd).toBeCloseTo(0.734, 6);
    expect(resolveCatalogRate(model, undefined, 1, {inputMode:'edit',size:'720p'}).costUsd).toBeNull();
  });
  it('rejects unsupported or oversized source files', () => {
    expect(() => validateEditVideo({size:1,type:'video/mp4'})).not.toThrow();
    for(const file of [{size:0,type:'video/mp4'},{size:100_000_001,type:'video/mp4'},{size:100,type:'image/png'}]) expect(() => validateEditVideo(file)).toThrow();
    const kling = FAL_VIDEO_MODELS.find(model => model.id === 'kling-o1-edit')?.variants.find(variant => variant.inputMode === 'edit')?.edit;
    expect(() => validateEditVideo({size:150_000_000,type:'video/mp4'}, kling)).not.toThrow();
    expect(() => validateEditVideo({size:150_000_000,type:'video/mp4'})).toThrow(/100 MB/);
  });
  it('floors Aleph 2 at the published $0.448 minimum', () => {
    const aleph = findModel('comet', 'aleph2');
    expect(resolveCatalogRate(aleph, 1, 1, {inputMode:'edit'}).costUsd).toBeCloseTo(0.448, 6);
    expect(resolveCatalogRate(aleph, 2, 1, {inputMode:'edit'}).costUsd).toBeCloseTo(0.448, 6);
    expect(resolveCatalogRate(aleph, 3, 1, {inputMode:'edit'}).costUsd).toBeCloseTo(0.672, 6);
    expect(resolveCatalogRate(aleph, 10, 1, {inputMode:'edit'}).costUsd).toBeCloseTo(2.24, 6);
  });
  it('preserves the upstream rejection detail for actionable errors', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({errors:[{message:'ByteDance responded with HTTP InvalidParameter. Additional information below.',additionalDetails:{responseContent:'Video pixel count must be greater than or equal to 407696.'}}]},{status:400})));
    await expect(runwareCreateVideo({apiKey:'test',model:request.model,inputMode:'edit',sourceVideo:source,prompt:request.prompt,resolution:'480p'})).rejects.toThrow('Video pixel count must be greater than or equal to 407696.');
  });
});

describe('P-Video-Edit', () => {
  const model = findModel('runware','prunaai:p-video@edit')!;
  it.each([false,true])('routes draft=%s with source and optional images, without Seedance settings', async draft => {
    const fetch = vi.fn().mockResolvedValue(Response.json({data:[{}]})); vi.stubGlobal('fetch',fetch);
    const response = await POST(new NextRequest('http://localhost/api/providers/video',{method:'POST',body:JSON.stringify({...request,model:model.id,size:undefined,draft,images:['data:image/png;base64,eA==']})}));
    expect(response.status).toBe(200);
    const [task] = JSON.parse(fetch.mock.calls[0][1].body);
    expect(task).toEqual({taskType:'videoInference',taskUUID:expect.any(String),model:model.id,positivePrompt:request.prompt,inputs:{video:source,referenceImages:['data:image/png;base64,eA==']},settings:{draft},deliveryMethod:'async',includeCost:true,outputFormat:'MP4'});
  });
  it('rejects incompatible settings and too many images before paid submission', async () => {
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    for (const change of [{size:'720p'},{draft:'true'},{durationSeconds:5},{audio:true},{images:Array(5).fill('data:image/png;base64,eA==')}]) {
      const response=await POST(new NextRequest('http://localhost/api/providers/video',{method:'POST',body:JSON.stringify({...request,model:model.id,size:undefined,...change})}));
      expect(response.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('applies the 15-second limit without inheriting Seedance pixel or minimum duration restrictions', () => {
    expect(()=>validateEditSource({durationSeconds:2,width:320,height:180},model.videoEdit!)).not.toThrow();
    expect(()=>validateEditSource({durationSeconds:15,width:1280,height:720},model.videoEdit!)).not.toThrow();
    expect(()=>validateEditSource({durationSeconds:15.01,width:1280,height:720},model.videoEdit!)).toThrow(/15/);
    expect(()=>validateEditSource({durationSeconds:NaN,width:1280,height:720},model.videoEdit!)).toThrow();
  });
  it('prices Standard and Draft using source duration', () => {
    expect(resolveCatalogRate(model,5,1,{inputMode:'edit'}).costUsd).toBeCloseTo(0.169);
    expect(resolveCatalogRate(model,5,1,{inputMode:'edit',draft:true}).costUsd).toBeCloseTo(0.094);
  });
});

describe('Runware reference edits', () => {
  const image = 'data:image/png;base64,eA==';
  const send = (body: unknown) => POST(new NextRequest('http://localhost/api/providers/video', { method: 'POST', body: JSON.stringify(body) }));
  const base = { provider: 'runware', apiKey: 'test-key', inputMode: 'edit', sourceVideo: source, prompt: 'Replace the background' };

  it('pins Aleph frame images and prices $0.28/s with no minimum', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
    vi.stubGlobal('fetch', fetch);
    const response = await send({ ...base, model: 'runway:aleph@2.0', images: [image, image], frameAnchors: 'first,t:1.25', sourceDurationSeconds: 6 });
    expect(response.status).toBe(200);
    const [task] = JSON.parse(fetch.mock.calls[0][1].body);
    expect(task).toMatchObject({
      model: 'runway:aleph@2.0', positivePrompt: 'Replace the background', includeCost: true, outputFormat: 'MP4',
      inputs: { video: source, frameImages: [{ image, frame: 'first' }, { image, timestamp: 1.25 }] },
    });
    expect(task).not.toHaveProperty('duration');
    expect(task).not.toHaveProperty('resolution');
    expect(task).not.toHaveProperty('settings');
    const model = findModel('runware', 'runway:aleph@2.0')!;
    expect(resolveCatalogRate(model, 1, 1, { inputMode: 'edit' }).costUsd).toBeCloseTo(0.28);
    expect(resolveCatalogRate(model, 6, 1, { inputMode: 'edit' }).costUsd).toBeCloseTo(1.68);
    expect(() => validateEditSource({ durationSeconds: 2, width: 1920, height: 1080 }, model.videoEdit!)).not.toThrow();
    expect(() => validateEditSource({ durationSeconds: 1.5, width: 1280, height: 720 }, model.videoEdit!)).toThrow(/between 2 and 30/);
    expect(() => validateEditSource({ durationSeconds: 6, width: 1921, height: 1080 }, model.videoEdit!)).toThrow(/at most 1920/);
    expect(editSourceSummary(model.videoEdit!)).toContain('2–30 seconds');
    expect(editSourceSummary(model.videoEdit!)).toContain('up to 1920px');
  });

  it('refuses an Aleph pin that does not match the images or the clip', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await send({ ...base, model: 'runway:aleph@2.0', images: [image], frameAnchors: 'first,last' })).status).toBe(400);
    expect((await send({ ...base, model: 'runway:aleph@2.0', images: [image], frameAnchors: 't:12', sourceDurationSeconds: 6 })).status).toBe(400);
    expect((await send({ ...base, model: 'runway:aleph@2.0', prompt: 'x'.repeat(1001) })).status).toBe(400);
    expect((await send({ ...base, model: 'runway:aleph@2.0', durationSeconds: 8 })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends Kling reference images and keeps original sound, with no duration', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
    vi.stubGlobal('fetch', fetch);
    for (const model of ['klingai:kling@o1', 'klingai:kling@o1-standard']) {
      fetch.mockClear();
      const response = await send({ ...base, model, images: [image], keepOriginalSound: false });
      expect(response.status, model).toBe(200);
      const [task] = JSON.parse(fetch.mock.calls[0][1].body);
      expect(task).toMatchObject({
        model, inputs: { video: source, referenceImages: [image] },
        providerSettings: { klingai: { keepOriginalSound: false } },
      });
      expect(task).not.toHaveProperty('duration');
      expect(task).not.toHaveProperty('resolution');
      expect(task.inputs).not.toHaveProperty('frameImages');
    }
    const o1 = findModel('runware', 'klingai:kling@o1')!;
    expect(o1.videoEdit?.rate).toBeUndefined();
    expect(o1.videoEdit?.maxSeconds).toBeUndefined();
    expect(resolveCatalogRate(o1, 6, 1, { inputMode: 'edit' }).costUsd).toBeNull();
    expect(editSourceSummary(o1.videoEdit!)).toContain('Up to 30 seconds');
    const aleph = findModel('runware', 'runway:aleph@2.0')!;
    expect(framePinsFor('t:1.25', 1, aleph.videoEdit!)).toEqual([{ timestamp: 1.25 }]);
    expect(framePinsFor('t:1.257', 1, aleph.videoEdit!)).toMatch(/two decimal places/);
    expect(editSourceSummary(o1.videoEdit!)).not.toContain('undefined');
    expect((await send({ ...base, model: 'klingai:kling@o1', prompt: 'A' })).status).toBe(400);
    expect((await send({ ...base, model: 'klingai:kling@o1', images: Array(5).fill(image) })).status).toBe(400);
  });

  it('sends Omni 4K at the documented 4k preset and $0.42/s', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
    vi.stubGlobal('fetch', fetch);
    const response = await send({ ...base, model: 'klingai:kling-video@o3-4k', images: [image] });
    expect(response.status).toBe(200);
    const [task] = JSON.parse(fetch.mock.calls[0][1].body);
    expect(task).toMatchObject({
      model: 'klingai:kling-video@o3-4k', resolution: '4k',
      inputs: { video: source, referenceImages: [image] },
      providerSettings: { klingai: { keepOriginalSound: true } },
    });
    expect(task).not.toHaveProperty('duration');
    const model = findModel('runware', 'klingai:kling-video@o3-4k')!;
    expect(resolveCatalogRate(model, 6, 1, { inputMode: 'edit' }).costUsd).toBeCloseTo(2.52);
    expect(() => validateEditSource({ durationSeconds: 15.5, width: 3840, height: 2160 }, model.videoEdit!)).not.toThrow();
    expect(() => validateEditSource({ durationSeconds: 15.51, width: 1920, height: 1080 }, model.videoEdit!)).toThrow(/15.5/);
    expect(() => validateEditSource({ durationSeconds: 6, width: 3840, height: 2161 }, model.videoEdit!)).toThrow(/8,294,400/);
    expect(() => validateEditSource({ durationSeconds: 6, width: 1000, height: 3000 }, model.videoEdit!)).toThrow(/1:2.5 and 2:1/);
  });

  it('estimates Aleph and Omni from a measured length and leaves O1 unknown until Runware reports a cost', () => {
    const request = (modelId: string, seconds?: number): CloudJobRequest => ({
      provider: 'runware', modelId, mediaType: 'video', inputMode: 'edit', prompt: 'Replace the sky',
      referenceIds: [], values: seconds === undefined ? {} : { sourceDurationSeconds: seconds },
    });
    expect(buildAccountSpendEntry({ jobId: 'aleph', request: request('runway:aleph@2.0', 6), result: { sources: [{}] }, at: 1 })).toMatchObject({ costUsd: expect.closeTo(1.68, 6), confidence: 'estimated' });
    expect(buildAccountSpendEntry({ jobId: 'aleph-exact', request: request('runway:aleph@2.0', 6), result: { sources: [{}], cost: 1.7 }, at: 1 })?.costUsd).toBe(1.7);
    expect(estimateCloudJob(request('klingai:kling-video@o3-4k', 6)).costUsd).toBeCloseTo(2.52);
    expect(buildAccountSpendEntry({ jobId: 'o1', request: request('klingai:kling@o1', 6), result: { sources: [{}] }, at: 1 })?.confidence).toBe('unknown');
    expect(estimateCloudJob(request('runway:aleph@2.0')).confidence).toBe('unknown');
  });
});
