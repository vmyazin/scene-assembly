import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { LOCAL_SCHEMA } from '../src/schema';
import { saveConnection } from '../src/vault';
import { acceptJob } from '../src/jobs';
import { adapterFor, validateRequest } from '../src/providers';
import { runGeneration } from '../src/generation-runner';
import { atlasPollVideo } from '../../lib/providers/atlas';
import type { Env } from '../src/security';
import type { CloudJobRequest } from '../../lib/account/contracts';
import { memoryBucket } from './bucket';

let db: DatabaseSync, env: Env;
const request: CloudJobRequest = {provider:'runware', modelId:'runware:400@1', mediaType:'image', inputMode:'text', prompt:'A product photograph', values:{aspectRatio:'16:9'}, referenceIds:[]};
beforeEach(async () => {
  db = new DatabaseSync(':memory:'); db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)");
  env = {DB:adapter(db), APP_ORIGIN:'http://localhost:3097', CLOUD_GENERATION_PROVIDERS:'runware,atlas', ACCOUNT_ENCRYPTION_VERSION:'1', ACCOUNT_ENCRYPTION_KEYS:JSON.stringify({'1':btoa('x'.repeat(32))})};
  await saveConnection(env,'owner','runware',{apiKey:'local-test-secret'});
});
afterEach(() => {vi.unstubAllGlobals(); db.close();});

describe('durable aggregator adapters', () => {
  it('submits PiAPI image jobs asynchronously and polls the same task', async () => {
    env.CLOUD_GENERATION_PROVIDERS = 'piapi';
    await saveConnection(env, 'owner', 'piapi', {apiKey: 'piapi-test-secret'});
    const mock = vi.fn().mockResolvedValueOnce(Response.json({code:200,data:{task_id:'piapi-task'}})).mockResolvedValueOnce(Response.json({code:200,data:{status:'completed',output:{image_url:'https://piapi.ai/result.png'}}}));
    vi.stubGlobal('fetch', mock);
    const r:CloudJobRequest = {...request,provider:'piapi',modelId:'nano-banana-2',values:{resolution:'4K',aspectRatio:'16:9'}};
    validateRequest(env,r);
    const job = await acceptJob(env,'owner','piapi-image-token',r);
    const provider = adapterFor(env,'piapi');
    const {handle} = await provider.submit(env,job);
    expect(handle).toEqual({id:'piapi-task'});
    expect(JSON.parse(mock.mock.calls[0][1].body)).toMatchObject({model:'gemini',task_type:'nano-banana-2',input:{resolution:'4K'}});
    expect(await provider.poll(env,job,handle!)).toMatchObject({state:'success',result:{sources:[{url:'https://piapi.ai/result.png'}]}});
    expect(mock.mock.calls[1][0]).toBe('https://api.piapi.ai/api/v1/task/piapi-task');
  });
  it('validates PiAPI reference limits, audio and model-specific settings before payment', () => {
    env.CLOUD_GENERATION_PROVIDERS = 'piapi';
    const r:CloudJobRequest = {...request,provider:'piapi',modelId:'nano-banana-2',inputMode:'image',referenceIds:Array.from({length:14},(_,i)=>`ref-${i}`),values:{resolution:'2K'}};
    expect(() => validateRequest(env,r)).not.toThrow();
    expect(() => validateRequest(env,{...r,referenceIds:[...r.referenceIds,'extra']})).toThrow(/up to 14/);
    expect(() => validateRequest(env,{...r,values:{audio:true}})).toThrow(/Audio/);
    const v:CloudJobRequest = {...r,modelId:'kling-3-omni',mediaType:'video',inputMode:'reference',referenceIds:['a','b','c','d','e'],values:{size:'1080p',durationSeconds:15,audio:true,aspectRatio:'1:1'}};
    expect(() => validateRequest(env,v)).not.toThrow();
    expect(() => validateRequest(env,{...v,modelId:'veo-3.1-fast'})).toThrow();
    expect(() => validateRequest(env,{...v,values:{audio:'true'}})).toThrow(/Audio/);
  });
  it('submits Comet video form fields and polls its returned task ID',async()=>{
    env.CLOUD_GENERATION_PROVIDERS='comet';await saveConnection(env,'owner','comet',{apiKey:'comet-test-secret'});
    const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({id:'comet-task',status:'queued'})).mockResolvedValueOnce(Response.json({status:'completed',video_url:'https://filesystem.site/result.mp4'}));vi.stubGlobal('fetch',fetchMock);
    const r:CloudJobRequest={...request,provider:'comet',modelId:'seedance-2-5',mediaType:'video',values:{durationSeconds:6,size:'720p · 16:9'}};
    validateRequest(env,r);const job=await acceptJob(env,'owner','comet-video-token',r),provider=adapterFor(env,'comet');
    const result=await provider.submit(env,job);
    expect(result.handle).toEqual({id:'comet-task'});
    const form=fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('seconds')).toBe('6');expect(form.get('size')).toBe('1280x720');
    expect(await provider.poll(env,job,result.handle!)).toMatchObject({state:'success',result:{sources:[{url:'https://filesystem.site/result.mp4'}]}});
  });
  it('stages Comet base64 with its documented output MIME and supports recovery',async()=>{
    env.CLOUD_GENERATION_PROVIDERS='comet';env.ASSETS=memoryBucket().bucket;await saveConnection(env,'owner','comet',{apiKey:'comet-test-secret'});
    const fetchMock=vi.fn().mockResolvedValue(Response.json({output_format:'jpeg',data:[{b64_json:'AQID'}]}));vi.stubGlobal('fetch',fetchMock);
    const r:CloudJobRequest={...request,provider:'comet',modelId:'gpt-image-2'};
    validateRequest(env,r);const job=await acceptJob(env,'owner','comet-image-token',r),provider=adapterFor(env,'comet');
    const result=await provider.submit(env,job);
    expect(result.result?.sources[0]).toMatchObject({mimeType:'image/jpeg',objectKey:`accounts/owner/jobs/${job.id}/0`});
    expect(await provider.recover!(env,job)).toEqual(result.result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('submits async images with the shared payload and polls the same UUID', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({data:[]})).mockResolvedValueOnce(Response.json({data:[{imageURL:'https://im.runware.ai/result.jpg',cost:0.03}]}));
    vi.stubGlobal('fetch', fetchMock);
    expect(validateRequest(env,request)).toEqual(request);
    const job = await acceptJob(env,'owner','runware-cloud-token',request);
    const provider = adapterFor(env,'runware');
    const {handle} = await provider.submit(env,job);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toEqual([expect.objectContaining({taskType:'imageInference',taskUUID:handle!.id,deliveryMethod:'async',width:1344,height:768,numberResults:1})]);
    expect(await provider.poll(env,job,handle!)).toMatchObject({state:'success',result:{sources:[{url:'https://im.runware.ai/result.jpg'}]}});
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual([{taskType:'getResponse',taskUUID:handle!.id}]);
  });
  it('accepts an Atlas first-and-last-frame pair and names what was wrong otherwise', () => {
    const frames={...request,provider:'atlas' as const,modelId:'bytedance/seedance-2.0-mini/image-to-video',mediaType:'video' as const,inputMode:'frames' as const,referenceIds:['first','last'],values:{}};
    expect(() => validateRequest(env,frames)).not.toThrow();
    expect(() => validateRequest(env,{...frames,referenceIds:['first']})).toThrow(/exactly two images/);
    expect(() => validateRequest(env,{...frames,inputMode:'image' as const,referenceIds:['first'],values:{size:'imaginary'}})).toThrow(/"imaginary" is not an output size/);
  });
  it('lets Atlas Developer editions carry a tier and a full set of references', () => {
    const nano = {...request,provider:'atlas' as const,modelId:'google/nano-banana-2/text-to-image-developer',values:{resolution:'4K',aspectRatio:'16:9'}};
    expect(() => validateRequest(env,nano)).not.toThrow();
    // Only the tiers the model publishes, and only on a model that has any.
    expect(() => validateRequest(env,{...nano,values:{resolution:'8K'}})).toThrow(/is not a resolution/);
    expect(() => validateRequest(env,{...nano,modelId:'google/nano-banana-2-lite/text-to-image-developer',values:{resolution:'4K'}})).toThrow(/is not a resolution/);
    expect(() => validateRequest(env,{...nano,modelId:'z-image/turbo'})).toThrow(/is not a resolution/);
    // The editors' documented reference limits, which a flat cap of one hid.
    const edit = {...nano,modelId:'google/nano-banana-2/edit-developer',inputMode:'image' as const,referenceIds:Array.from({length:14},(_,i)=>`ref-${i}`),values:{}};
    expect(() => validateRequest(env,edit)).not.toThrow();
    expect(() => validateRequest(env,{...edit,referenceIds:[...edit.referenceIds,'extra']})).toThrow(/up to 14/);
    expect(() => validateRequest(env,{...edit,modelId:'openai/gpt-image-2.5-sunburst-developer/edit',referenceIds:Array.from({length:16},(_,i)=>`ref-${i}`)})).not.toThrow();
  });
  it('sends MiniMax H3 the resolution preset the catalog publishes', async () => {
    await saveConnection(env,'owner','atlas',{apiKey:'atlas-test-secret'});
    const mock = vi.fn().mockResolvedValueOnce(Response.json({data:{id:'h3-task'}}));
    vi.stubGlobal('fetch', mock);
    const r:CloudJobRequest = {...request,provider:'atlas',modelId:'minimax/h3-developer/text-to-video',mediaType:'video',inputMode:'text',values:{size:'768p',durationSeconds:8,aspectRatio:'16:9'}};
    validateRequest(env,r);
    const job = await acceptJob(env,'owner','atlas-h3-video-token',r);
    await adapterFor(env,'atlas').submit(env,job);
    // The label is `768p`; the wire value is the capital-P preset, under `ratio`.
    expect(JSON.parse(mock.mock.calls[0][1].body)).toMatchObject({resolution:'768P',ratio:'16:9',duration:8});
  });
  it('rejects invalid media, references, arbitrary fields and unsupported size before intake', () => {
    for (const patch of [{modelId:'arbitrary-model'},{mediaType:'video'},{inputMode:'image'}, {values:{size:'imaginary'}}, {values:{durationSeconds:8}}, {values:{apiKey:'untrusted'}}]) {
      expect(() => validateRequest(env,{...request,...patch})).toThrow();
    }
  });
  it('uses a server-resolved video size and duration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({data:[]})); vi.stubGlobal('fetch',fetchMock);
    const r:CloudJobRequest = {...request, modelId:'lightricks:ltx@2.5-fast', mediaType:'video',values:{size:'720p · 16:9',durationSeconds:8}};
    validateRequest(env,r);
    const job = await acceptJob(env,'owner','runware-video-token',r);
    await adapterFor(env,'runware').submit(env,job);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0]).toMatchObject({taskType:'videoInference',width:1280,height:720,duration:8});
  });
  it('does not repeat a paid request after transport loss', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('lost response')); vi.stubGlobal('fetch',fetchMock);
    const job = await acceptJob(env,'owner','runware-lost-token',request);
    const step = {do:async(_name:unknown,_config:unknown,fn:()=>Promise<unknown>) => fn(),sleep:async()=>{}};
    // Use the real runner so replay is tested across persisted job state.
    await runGeneration(env,job.id,step as Parameters<typeof runGeneration>[2]);
    await runGeneration(env,job.id,step as Parameters<typeof runGeneration>[2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT state,error_code FROM account_jobs WHERE id=?').get(job.id)).toMatchObject({state:'needs_attention',error_code:'submission_ambiguous'});
  });
  it.each([
    {data:{status:'completed',outputs:['https://atlascloud.ai/result.png']}},
    {status:'succeeded',output:['https://atlascloud.ai/result.png']},
  ])('reads current and legacy Atlas results', async payload => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(payload)));
    expect(await atlasPollVideo({apiKey:'test',taskId:'prediction'})).toMatchObject({state:'success',urls:['https://atlascloud.ai/result.png']});
  });
  it('recognizes current Atlas terminal failures', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({data:{status:'failed',error:'Model could not finish',outputs:[]}})));
    expect(await atlasPollVideo({apiKey:'test',taskId:'prediction'})).toMatchObject({state:'error',error:'Model could not finish'});
  });
});
