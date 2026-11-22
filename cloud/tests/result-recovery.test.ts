import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { AccountError, acceptJob, getJob, jobView } from '../src/jobs';
import { safeResultUrl } from '../src/assets';
import { jobRoutes } from '../src/job-routes';
import { runGeneration, type DurableStep } from '../src/generation-runner';
import { hash, type Env } from '../src/security';
import { canRetryResultLocation } from '../src/result-recovery';
import { providerBrowserUrl } from '../../lib/account/result-location';
import { MAX_RESUME_ATTEMPTS } from '../../lib/account/job-failure';
const session='recovery-session-token-123456789012345';
const step:DurableStep={do:async(_name,_config,fn)=>fn(),sleep:async()=>{}};
let db:DatabaseSync,env:Env;
beforeEach(async()=>{
  db=new DatabaseSync(':memory:');db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1),('other','other','other@example.test','Other',1)");
  env={DB:adapter(db),ASSETS:memoryBucket().bucket,APP_ORIGIN:'http://localhost:3097'};
  await env.DB.prepare('INSERT INTO account_sessions VALUES (?,?,?)').bind(await hash(session),'owner',Date.now()+60_000).run();
});
afterEach(()=>{vi.unstubAllGlobals();db.close();});
let fixtures=0;
async function blocked(url='https://atlas-media.oss-us-west-1.aliyuncs.com/output.png',owner='owner',mediaType:'image'|'video'='image'){
  // A distinct prompt per fixture: the same token and request return the same row.
  const job=await acceptJob(env,owner,`recovery-token-${String(fixtures++).padStart(14,'0')}`,{provider:'local-test',modelId:'local-test',mediaType,inputMode:'text',prompt:'recovery fixture',values:{},referenceIds:[]});
  await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',failure_reason='result_location',error_code='save_failed',provider_task=?,result_json=? WHERE id=?")
    .bind(JSON.stringify({id:'provider-task-123'}),JSON.stringify({sources:[{url}]}),job.id).run();
  return (await getJob(env,job.id))!;
}
const request=(id:string,action='recovery',method='GET',cookie=session)=>jobRoutes(new Request(`http://localhost:8797/api/account/jobs/${id}/${action}`,{method,headers:{cookie:`sa_session=${cookie}`}}),env);

it('lets an older blocked job use the now-approved address and saves without submitting or polling',async()=>{
  const job=await blocked();
  expect(jobView(job).canRetrySave).toBe(true);
  expect(JSON.stringify(jobView(job))).not.toContain('output.png');
  expect((await request(job.id,'resume','POST'))?.status).toBe(202);
  const provider={submit:vi.fn(),poll:vi.fn()};
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(png,{headers:{'Content-Type':'image/png'}})));
  await runGeneration(env,job.id,step,provider);
  expect((await getJob(env,job.id))?.state).toBe('saved');
  expect(provider.submit).not.toHaveBeenCalled();expect(provider.poll).not.toHaveBeenCalled();
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_assets WHERE job_id=?').get(job.id)?.n).toBe(1);
});

it('accepts the Runway CloudFront distribution Comet Aleph returns, but not all of cloudfront.net',async()=>{
  expect(jobView(await blocked('https://dnznrvs05pmza.cloudfront.net/aleph/output.mp4?_jwt=signed')).canRetrySave).toBe(true);
  expect(jobView(await blocked('https://d1234example.cloudfront.net/output.mp4')).canRetrySave).toBe(false);
  expect(jobView(await blocked('https://cloudfront.net/output.mp4')).canRetrySave).toBe(false);
});

it('re-opens a Kling 4.0 job blocked on Atlas\'s temp bucket, but not one on a sibling bucket',async()=>{
  expect(jobView(await blocked('https://temp-24h-m4x2.oss-accelerate-overseas.aliyuncs.com/kling/out.mp4?Expires=1&Signature=x')).canRetrySave).toBe(true);
  expect(jobView(await blocked('https://temp-24h-zz99.oss-accelerate-overseas.aliyuncs.com/out.mp4')).canRetrySave).toBe(false);
});

it('re-opens a Kie job blocked on tempfile.aiquickdraw.com and saves its video without submitting or polling',async()=>{
  const url='https://tempfile.aiquickdraw.com/f/kie-task/output.mp4';
  const job=await blocked(url,'owner','video');
  expect(jobView(job).canRetrySave).toBe(true);
  expect((await request(job.id,'resume','POST'))?.status).toBe(202);
  const provider={submit:vi.fn(),poll:vi.fn()};
  const mp4=Uint8Array.from([0,0,0,0x18,...new TextEncoder().encode('ftypisom'),1,2,3,4]);
  const fetcher=vi.fn().mockResolvedValue(new Response(mp4,{headers:{'Content-Type':'video/mp4'}}));
  vi.stubGlobal('fetch',fetcher);
  await runGeneration(env,job.id,step,provider);
  expect(String(fetcher.mock.calls[0][0])).toBe(url);
  expect((await getJob(env,job.id))?.state).toBe('saved');
  expect(provider.submit).not.toHaveBeenCalled();expect(provider.poll).not.toHaveBeenCalled();
  expect(db.prepare('SELECT kind,mime_type,bytes FROM account_assets WHERE job_id=?').get(job.id)).toEqual({kind:'video',mime_type:'video/mp4',bytes:mp4.byteLength});
});

it('keeps look-alikes of the Kie temporary host blocked, in the resume check and in capture',async()=>{
  for(const url of ['http://tempfile.aiquickdraw.com/out.mp4','https://tempfile.aiquickdraw.com.evil.test/out.mp4','https://eviltempfile.aiquickdraw.com/out.mp4','https://aiquickdraw.com.evil/out.mp4','https://aiquickdraw.com/out.mp4','https://a.tempfile.aiquickdraw.com/out.mp4']){
    expect(jobView(await blocked(url)).canRetrySave).toBe(false);
    expect(()=>safeResultUrl(url)).toThrow(AccountError);
  }
  expect(safeResultUrl('https://tempfile.aiquickdraw.com/out.mp4').hostname).toBe('tempfile.aiquickdraw.com');
  expect(jobView(await blocked('https://file.aiquickdraw.com/v/out.mp4')).canRetrySave).toBe(true);
  for(const url of ['https://static.aiquickdraw.com/out.mp4','https://tempfileb.aiquickdraw.com/out.mp4','https://file.aiquickdraw.com.evil.test/out.mp4'])expect(jobView(await blocked(url)).canRetrySave).toBe(false);
});

it('does not follow a redirect from the Kie temporary host to a host outside the policy',async()=>{
  const job=await blocked('https://tempfile.aiquickdraw.com/out.png');
  await request(job.id,'resume','POST');
  const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'https://tempfile.aiquickdraw.com.evil.test/out.png'}}));
  vi.stubGlobal('fetch',fetcher);
  await runGeneration(env,job.id,step,{submit:vi.fn(),poll:vi.fn()});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await getJob(env,job.id)).toMatchObject({state:'needs_attention',failure_reason:'result_location'});
});

it('offers owner-requested manual links for unknown hosts without fetching them or enabling capture',async()=>{
  const url='https://new-provider-cdn.example.com/result.mp4?signature=private';
  const job=await blocked(url);
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect(jobView(job).canRetrySave).toBe(false);
  const response=await request(job.id);
  expect(response?.headers.get('cache-control')).toBe('no-store');
  expect(await response?.json()).toEqual({links:[{url,hostname:'new-provider-cdn.example.com'}],providerTaskId:'provider-task-123'});
  expect((await request(job.id,'resume','POST'))?.status).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await getJob(env,job.id))?.workflow_attempt).toBe(0);
});

it('keeps recovery private to the owner and refuses removed or non-attention jobs',async()=>{
  const job=await blocked();
  expect((await request(job.id,'recovery','GET','invalid-session'))?.status).toBe(401);
  const other=await blocked('https://fal.media/output.png','other');
  expect((await request(other.id))?.status).toBe(404);
  db.prepare("UPDATE account_jobs SET state='saved' WHERE id=?").run(job.id);
  expect((await request(job.id))?.status).toBe(409);
  db.prepare('UPDATE account_jobs SET deleted=1 WHERE id=?').run(job.id);
  expect((await request(job.id))?.status).toBe(404);
});

it('preserves the attempt cap and rejects partial or malformed stored results',async()=>{
  const job=await blocked();
  db.prepare('UPDATE account_jobs SET workflow_attempt=? WHERE id=?').run(MAX_RESUME_ATTEMPTS,job.id);
  expect(await (await request(job.id,'resume','POST'))?.json()).toMatchObject({code:'resume_exhausted'});
  for(const result of [null,{}, {sources:[]},{sources:[null,{url:'https://fal.media/good.png'}]},{sources:[{url:'https://fal.media/good.png'},{url:'https://unknown.example.com/file'}]}]){
    expect(canRetryResultLocation({...job,result_json:JSON.stringify(result)})).toBe(false);
  }
});

it('does not turn invalid addresses or credentials into browser links',async()=>{
  for(const url of ['javascript:alert(1)','data:text/html,hi','http://fal.media/file','https://user:secret@fal.media/file','https://localhost/file','https://host.local/file','https://127.1/file','https://0x7f000001/file','https://[::1]/file','https://example.com:8080/file','not a URL']){
    expect(providerBrowserUrl(url)).toBeNull();
  }
  const job=await blocked('https://127.0.0.1/private');
  expect(await (await request(job.id))?.json()).toEqual({links:[],providerTaskId:'provider-task-123'});
});
