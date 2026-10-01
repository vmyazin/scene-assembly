import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob, getJob, jobView } from '../src/jobs';
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
async function blocked(url='https://atlas-media.oss-us-west-1.aliyuncs.com/output.png',owner='owner'){
  const job=await acceptJob(env,owner,'recovery-token-00000000000000',{provider:'local-test',modelId:'local-test',mediaType:'image',inputMode:'text',prompt:'recovery fixture',values:{},referenceIds:[]});
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
