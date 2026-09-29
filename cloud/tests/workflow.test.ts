import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob, getJob } from '../src/jobs';
import { runGeneration, type DurableStep } from '../src/generation-runner';
import { captureResult, deleteAsset, safeResultUrl, writeOutput } from '../src/assets';
import { serveObject } from '../src/media';
import type { Env } from '../src/security';
import type { GenerationAdapter } from '../src/providers';
const step:DurableStep={do:async(_name,_config,fn)=>fn(),sleep:async()=>{}};
let db:DatabaseSync,env:Env;
beforeEach(()=>{db=new DatabaseSync(':memory:');db.exec(LOCAL_SCHEMA);db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)");env={DB:adapter(db),ASSETS:memoryBucket().bucket,APP_ORIGIN:'http://localhost:3097'};});
afterEach(()=>db.close());
const job=()=>acceptJob(env,'owner','workflow-test-token',{provider:'local-test',modelId:'local-test',mediaType:'image',inputMode:'text',prompt:'test',values:{},referenceIds:[]});
describe('background generation and capture',()=>{
  it('finishes without a browser and releases quota only once on replay',async()=>{
    const j=await job();await runGeneration(env,j.id,step);await runGeneration(env,j.id,step);
    expect((await getJob(env,j.id))?.state).toBe('saved');
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_assets').get()?.n).toBe(1);
    expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage').get()).toMatchObject({reserved_bytes:0,active_jobs:0});
  });
  it('does not resubmit after an ambiguous provider response',async()=>{
    const j=await job();const submit=vi.fn().mockRejectedValue(new Error('lost response'));
    const provider:GenerationAdapter={submit,poll:vi.fn()};
    await runGeneration(env,j.id,step,provider);await runGeneration(env,j.id,step,provider);
    expect(submit).toHaveBeenCalledTimes(1);
    expect((await getJob(env,j.id))?.error_code).toBe('submission_ambiguous');
  });
  it('resumes persisted provider work without submitting again',async()=>{
    const j=await job();await env.DB.prepare("UPDATE account_jobs SET state='running',provider_task=? WHERE id=?").bind(JSON.stringify({id:'provider-task'}),j.id).run();
    const key=`accounts/owner/jobs/${j.id}/0`;
    await writeOutput(env,key,new Uint8Array([1,2,3]),'image/png');
    const provider:GenerationAdapter={submit:vi.fn(),poll:vi.fn().mockResolvedValue({state:'success',result:{sources:[{objectKey:key,mimeType:'image/png'}]}})};
    await runGeneration(env,j.id,step,provider);expect(provider.submit).not.toHaveBeenCalled();expect((await getJob(env,j.id))?.state).toBe('saved');
  });
  it('recovers R2 success before metadata commit and never resurrects deletion',async()=>{
    const j=await job();const key=`accounts/owner/jobs/${j.id}/0`;await writeOutput(env,key,new Uint8Array([1,2,3]),'image/png');
    const result={sources:[{objectKey:key,mimeType:'image/png'}]};
    await captureResult(env,j,result);await captureResult(env,j,result);
    expect(db.prepare('SELECT used_bytes FROM account_storage').get()?.used_bytes).toBe(3);
    await deleteAsset(env,`${j.id}-0`,'owner');await captureResult(env,j,result);
    expect(db.prepare('SELECT used_bytes FROM account_storage').get()?.used_bytes).toBe(0);
    expect(db.prepare('SELECT deleted FROM account_assets').get()?.deleted).toBe(1);
  });
  it('persists the validated response MIME when multipart completion omits metadata',async()=>{
    const j=await job();
    env.ASSETS=memoryBucket({completeOmitsMetadata:true}).bucket;
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}})));
    await captureResult(env,j,{sources:[{url:'https://im.runware.ai/output.png'}]});
    expect(db.prepare('SELECT mime_type FROM account_assets WHERE job_id=?').get(j.id)?.mime_type).toBe('image/png');
  });
  it('does not count a result whose account/job was deleted during transfer',async()=>{
    const j=await job();const key=`accounts/owner/jobs/${j.id}/0`;await writeOutput(env,key,new Uint8Array([1,2,3]),'image/png');
    db.prepare('UPDATE account_jobs SET deleted=1 WHERE id=?').run(j.id);
    await captureResult(env,j,{sources:[{objectKey:key,mimeType:'image/png'}]});
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_assets').get()?.n).toBe(0);
    expect(db.prepare('SELECT used_bytes FROM account_storage').get()?.used_bytes).toBe(0);
  });
  it('rejects unsafe result URLs and redirects before fetching private networks',()=>{
    for(const url of ['http://fal.media/file','https://127.0.0.1/file','https://fal.media.evil.test/file','https://user:secret@fal.media/file'])expect(()=>safeResultUrl(url)).toThrow();
    expect(safeResultUrl('https://v3.fal.media/files/result.png').hostname).toBe('v3.fal.media');
  });
  it('accepts the bucket Atlas delivers results from, and no other bucket on the same storage host',()=>{
    expect(safeResultUrl('https://atlas-media.oss-us-west-1.aliyuncs.com/outputs/result.png').hostname).toBe('atlas-media.oss-us-west-1.aliyuncs.com');
    for(const url of ['https://someone-else.oss-us-west-1.aliyuncs.com/file','https://oss-us-west-1.aliyuncs.com/file','https://aliyuncs.com/file'])expect(()=>safeResultUrl(url)).toThrow();
  });
});

describe('private video range downloads',()=>{
  it('supports bounded, open-ended and suffix ranges and rejects invalid requests',async()=>{
    const {byteRange}=await import('../src/job-routes');
    expect(byteRange('bytes=0-9',100)).toEqual({offset:0,length:10});
    expect(byteRange('bytes=90-',100)).toEqual({offset:90,length:10});
    expect(byteRange('bytes=-10',100)).toEqual({offset:90,length:10});
    expect(byteRange('bytes=100-',100)).toBe('invalid');
    expect(byteRange('bytes=0-1,4-5',100)).toBe('invalid');
  });
});

describe('private asset response types',()=>{
  it('uses supported R2 metadata for legacy generic database MIME values',async()=>{
    env.ASSETS=memoryBucket({completeOmitsMetadata:true}).bucket;
    await writeOutput(env,'accounts/owner/legacy.png',new Uint8Array([137,80,78,71]),'image/png');
    const response=await serveObject(new Request('https://worker.test/media'),env,'accounts/owner/legacy.png','application/octet-stream',4);
    expect(response.headers.get('Content-Type')).toBe('image/png');
  });
  it('preserves the recovered MIME for private range HEAD responses',async()=>{
    env.ASSETS=memoryBucket({completeOmitsMetadata:true}).bucket;
    await writeOutput(env,'accounts/owner/legacy.png',new Uint8Array([137,80,78,71]),'image/png');
    const response=await serveObject(new Request('https://worker.test/media',{method:'HEAD',headers:{Range:'bytes=0-1'}}),env,'accounts/owner/legacy.png','application/octet-stream',4);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Range')).toBe('bytes 0-1/4');
  });
  it('does not trust unsupported R2 metadata for a generic database MIME',async()=>{
    const {bucket,objects}=memoryBucket();
    objects.set('accounts/owner/untrusted',{bytes:new Uint8Array([1]),contentType:'text/html'});
    env.ASSETS=bucket;
    const response=await serveObject(new Request('https://worker.test/media'),env,'accounts/owner/untrusted','application/octet-stream',1);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  });
});
