import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/providers/video/route';
import { runwareCreateVideo } from '@/lib/providers/runware';
import { findModel } from '@/lib/providers/catalog';
import { resolveCatalogRate } from '@/lib/spend/resolve';
import { validateEditVideo, validateEditSource } from '@/lib/providers/video-edit';
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
    for (const change of [{sourceVideo: undefined}, {sourceVideo: 'https://private.test/a.mp4'}, {provider: 'atlas'}, {model: 'alibaba:wan@3.0'}, {durationSeconds: 6}, {aspectRatio: '16:9'}, {size: '1080p'}, {images:Array(6).fill('data:image/png;base64,eA==')}]) expect((await send({...request,...change})).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('estimates edits at the video-to-video rate instead of the generation rate', () => {
    const model=findModel('runware',request.model);
    expect(resolveCatalogRate(model, 4, 1, {inputMode:'edit',size:'720p'})).toMatchObject({costUsd:1.18,confidence:'estimated'});
    expect(resolveCatalogRate(model, undefined, 1, {inputMode:'edit',size:'720p'}).costUsd).toBeNull();
  });
  it('rejects unsupported or oversized source files', () => {
    expect(() => validateEditVideo({size:1,type:'video/mp4'})).not.toThrow();
    for(const file of [{size:0,type:'video/mp4'},{size:100_000_001,type:'video/mp4'},{size:100,type:'image/png'}]) expect(() => validateEditVideo(file)).toThrow();
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
