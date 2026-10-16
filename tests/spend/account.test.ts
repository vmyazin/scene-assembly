import { describe, expect, it } from 'vitest';

import type { CloudJobRequest } from '@/lib/account/contracts';
import { buildAccountSpendEntry, type PersistedProviderResult } from '@/lib/spend/account';

const request = (patch:Partial<CloudJobRequest> = {}):CloudJobRequest => ({
  provider:'gemini',modelId:'gemini-3-pro-image-preview',mediaType:'image',inputMode:'text',
  prompt:`  ${'painted clouds '.repeat(20)}`,values:{imageSize:'2K'},referenceIds:[],...patch,
});
const result = (patch:Partial<PersistedProviderResult> = {}):PersistedProviderResult => ({sources:[{}],...patch});

describe('account spend entry builder',()=>{
  it('uses the saved Atlas video size and duration', () => {
    const entry = buildAccountSpendEntry({
      jobId: 'atlas-video', at: 1, result: result(),
      request: request({ provider: 'atlas', modelId: 'bytedance/seedance-2.0-fast/text-to-video',
        mediaType: 'video', values: { size: '720p', durationSeconds: 10 } }),
    });
    expect(entry?.costUsd).toBeCloseTo(0.581, 6);
    expect(entry?.confidence).toBe('estimated');
  });

  it('bills an Atlas Wan edit from the shorter of the output and the source', () => {
    const wan = (values: CloudJobRequest['values']) => request({
      provider: 'atlas', modelId: 'alibaba/wan-2.7/video-edit', mediaType: 'video', inputMode: 'edit',
      prompt: 'Change the coat', values,
    });
    const longerOutput = buildAccountSpendEntry({
      jobId: 'wan-long', at: 1, result: result(),
      request: wan({ size: '720P', sourceDurationSeconds: 3, outputDuration: 10 }),
    });
    const shorterOutput = buildAccountSpendEntry({
      jobId: 'wan-short', at: 1, result: result(),
      request: wan({ size: '1080P', sourceDurationSeconds: 10, outputDuration: 3 }),
    });
    const matchSource = buildAccountSpendEntry({
      jobId: 'wan-match', at: 1, result: result(),
      request: wan({ size: '720P', sourceDurationSeconds: 10, outputDuration: 0 }),
    });
    expect(longerOutput?.costUsd).toBeCloseTo(0.3, 6);
    expect(shorterOutput?.costUsd).toBeCloseTo(0.3, 6);
    expect(matchSource?.costUsd).toBeCloseTo(1, 6);
  });

  it('keeps an unpriced Atlas resolution unknown with the relevant explanation', () => {
    const entry = buildAccountSpendEntry({
      jobId: 'atlas-unknown', at: 1, result: result(),
      request: request({ provider: 'atlas', modelId: 'bytedance/seedance-2.0-fast/text-to-video',
        mediaType: 'video', values: { size: '1440p (upscaled)', durationSeconds: 10 } }),
    });
    expect(entry).toMatchObject({ costUsd: null, confidence: 'unknown', note: expect.stringContaining('output size') });
  });

  it('counts Seedream references and ignores the unused shared imageSize preference', () => {
    const entry = buildAccountSpendEntry({
      jobId: 'atlas-edit', at: 1, result: result(),
      request: request({ provider: 'atlas', modelId: 'bytedance/seedream-v5.0-pro/edit',
        inputMode: 'image', referenceIds: ['a', 'b', 'c'], values: { imageSize: '2K' } }),
    });
    expect(entry?.costUsd).toBeCloseTo(0.042, 6);
  });
  it('prices Gemini usage once even with multiple outputs and limits the prompt excerpt',()=>{
    const entry=buildAccountSpendEntry({jobId:'job-1',request:request(),result:result({sources:[{},{}],usage:{promptTokens:100,outputTokens:1120}}),at:123});
    expect(entry).toMatchObject({id:'gemini-job-1',at:123,confidence:'exact',source:'usage-metadata',quantity:{unit:'token',value:1220}});
    expect(entry?.promptExcerpt.length).toBe(120);
    expect(entry?.costUsd).toBeCloseTo(0.1346);
  });

  it('charges Gemini fallback input tokens once when one request returns multiple images',()=>{
    const entry=buildAccountSpendEntry({
      jobId:'job-gemini-fallback',
      request:request({inputMode:'image',referenceIds:['reference']}),
      result:result({sources:[{},{}]}),
      at:1,
    });
    expect(entry).toMatchObject({confidence:'estimated',quantity:{unit:'image',value:2}});
    expect(entry?.costUsd).toBeCloseTo(0.26992);
  });

  it('multiplies per-image published estimates by the number of results',()=>{
    const entry=buildAccountSpendEntry({jobId:'job-2',request:request({provider:'atlas',modelId:'black-forest-labs/flux-schnell'}),result:result({sources:[{}, {}, {}]}),at:1});
    expect(entry).toMatchObject({confidence:'estimated',source:'catalog-rate',quantity:{unit:'image',value:3}});
    expect(entry?.costUsd).toBeCloseTo(0.009);
  });

  it('uses published fal controls without making an estimate API call',()=>{
    const entry=buildAccountSpendEntry({jobId:'job-3',request:request({provider:'fal',modelId:'nano-banana-2',values:{resolution:'2K',enable_web_search:true}}),result:result(),at:1});
    expect(entry).toMatchObject({costUsd:0.135,confidence:'estimated',source:'catalog-rate',quantity:{unit:'image',value:1}});
  });

  it('uses fal canonical audio-on pricing when the saved control is absent',()=>{
    const entry=buildAccountSpendEntry({
      jobId:'job-fal-video',
      request:request({provider:'fal',modelId:'veo-3-1',mediaType:'video',values:{resolution:'1080p',duration:'5s'}}),
      result:result(),
      at:1,
    });
    expect(entry).toMatchObject({costUsd:2,confidence:'estimated',source:'catalog-rate',quantity:{unit:'second',value:5}});
  });

  it.each(['kie','pollinations','cloudflare'] as const)('does not call an own-key %s generation free',provider=>{
    const entry=buildAccountSpendEntry({jobId:`job-${provider}`,request:request({provider}),result:result(),at:1});
    expect(entry).toMatchObject({costUsd:null,confidence:'unknown'});
    expect(entry?.note).toBeTruthy();
  });

  it('preserves Runware response cost and only claims an existing first asset',()=>{
    const without=buildAccountSpendEntry({jobId:'job-r',request:request({provider:'runware',modelId:'runware:z-image@turbo'}),result:result({cost:0.031}),at:1});
    const withAsset=buildAccountSpendEntry({jobId:'job-r',request:request({provider:'runware',modelId:'runware:z-image@turbo'}),result:result({cost:0.031}),at:1,firstAssetId:'job-r-0'});
    expect(without).toMatchObject({costUsd:0.031,confidence:'exact',source:'response'});
    expect(without).not.toHaveProperty('galleryRecordId');
    expect(withAsset?.galleryRecordId).toBe('job-r-0');
  });

  it('skips the local fixture and snapshots without a confirmed result',()=>{
    expect(buildAccountSpendEntry({jobId:'local',request:request({provider:'local-test'}),result:result(),at:1})).toBeNull();
    expect(buildAccountSpendEntry({jobId:'empty',request:request(),result:result({sources:[]}),at:1})).toBeNull();
  });
});
