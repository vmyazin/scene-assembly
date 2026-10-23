import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { LOCAL_SCHEMA } from '../src/schema';
import { saveConnection } from '../src/vault';
import { acceptJob } from '../src/jobs';
import { adapterFor, validateRequest } from '../src/providers';
import { modelsForFalMode } from '../../lib/fal/catalog';
import { KIE_MODELS } from '../../lib/kie/catalog';
import type { Env } from '../src/security';
import type { CloudJobRequest } from '../../lib/account/contracts';
let db:DatabaseSync, env:Env;
const model=KIE_MODELS.find(m=>m.mediaType==='image'&&m.variants.some(v=>v.inputMode==='text'))!;
const request:CloudJobRequest={provider:'kie',modelId:model.id,mediaType:'image',inputMode:'text',prompt:'A studio product photo',values:{},referenceIds:[]};
beforeEach(async()=>{
  db=new DatabaseSync(':memory:');db.exec(LOCAL_SCHEMA);db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)");
  env={DB:adapter(db),APP_ORIGIN:'http://localhost:3097',CLOUD_GENERATION_PROVIDERS:'kie,fal',ACCOUNT_ENCRYPTION_VERSION:'1',ACCOUNT_ENCRYPTION_KEYS:JSON.stringify({'1':btoa('x'.repeat(32))})};
  await saveConnection(env,'owner','kie',{apiKey:'test-provider-secret'});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();db.close();});
describe('queued native adapters',()=>{
  it('keeps unverified production coverage disabled explicitly',()=>{
    expect(()=>adapterFor({...env,CLOUD_GENERATION_PROVIDERS:undefined},'kie')).toThrow(/not enabled/);
    expect(()=>adapterFor(env,'gemini')).toThrow(/not enabled/);
  });
  it('rejects invalid model, mismatched media and absent references before intake',()=>{
    expect(validateRequest(env,request)).toEqual(request);
    for(const patch of [{modelId:'unlisted-model'},{mediaType:'video'},{inputMode:'image'}])expect(()=>validateRequest(env,{...request,...patch})).toThrow();
  });
  it('submits once and polls the saved task using the encrypted owner connection',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({code:200,data:{taskId:'kie-task-1'}})).mockResolvedValueOnce(Response.json({code:200,data:{taskId:'kie-task-1',state:'success',resultJson:JSON.stringify({resultUrls:['https://tempfile.ai/result.png']})}}));
    vi.stubGlobal('fetch',fetchMock);
    const job=await acceptJob(env,'owner','queued-adapter-test',request), provider=adapterFor(env,'kie');
    const submitted=await provider.submit(env,job);
    expect(submitted.handle).toEqual({id:'kie-task-1',protocol:'market'});
    const status=await provider.poll(env,job,submitted.handle!);
    expect(status).toMatchObject({state:'success',result:{sources:[{url:'https://tempfile.ai/result.png'}]}});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-provider-secret');
    expect(fetchMock.mock.calls[1][0]).toContain('taskId=kie-task-1');
  });
  it('does not retry a failed submission transport',async()=>{
    const fetchMock=vi.fn().mockRejectedValue(new Error('connection lost'));vi.stubGlobal('fetch',fetchMock);
    const job=await acceptJob(env,'owner','queued-adapter-test',request);
    await expect(adapterFor(env,'kie').submit(env,job)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reuses the fal queue client without repeating a failed paid submit',async()=>{
    await saveConnection(env,'owner','fal',{apiKey:'fal-test-secret'});
    const falModel=modelsForFalMode('image','text')[0];
    const r:CloudJobRequest={...request,provider:'fal',modelId:falModel.id};
    expect(validateRequest(env,r)).toEqual(r);
    const fetchMock=vi.fn().mockResolvedValue(Response.json({detail:'unavailable'},{status:503}));vi.stubGlobal('fetch',fetchMock);
    const job=await acceptJob(env,'owner','fal-adapter-test-token',r);
    vi.useFakeTimers();
    const outcome=adapterFor(env,'fal').submit(env,job).catch(error=>error);
    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.runAllTimersAsync();
    expect(await outcome).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports fal refusing a completed request as failed, not a status read to retry',async()=>{
    await saveConnection(env,'owner','fal',{apiKey:'fal-test-secret'});
    const r:CloudJobRequest={...request,provider:'fal',modelId:modelsForFalMode('image','text')[0].id};
    const job=await acceptJob(env,'owner','fal-refusal-test-token',r);
    const requestId='fal-request-0001';
    const detail='The images or videos provided may contain likenesses of real people';
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>String(input instanceof Request?input.url:input).includes('/status')
      ?Response.json({status:'COMPLETED',request_id:requestId})
      :Response.json({detail:[{loc:['body','image_url'],msg:detail,type:'content_policy_violation'}]},{status:422})));
    const status=await adapterFor(env,'fal').poll(env,job,{id:requestId});
    expect(status.state).toBe('failed');
    expect(status.reason).toContain(detail);
  });
  it('refuses to use changed or revoked connections for existing jobs',async()=>{
    const job=await acceptJob(env,'owner','queued-adapter-test',request);
    await saveConnection(env,'owner','kie',{apiKey:'replacement-secret'});
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    await expect(adapterFor(env,'kie').submit(env,job)).rejects.toThrow(/changed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
