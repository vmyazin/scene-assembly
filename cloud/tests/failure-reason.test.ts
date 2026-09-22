import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob, getJob } from '../src/jobs';
import { jobRoutes } from '../src/job-routes';
import { runGeneration, type DurableStep } from '../src/generation-runner';
import { MAX_RESUME_ATTEMPTS, sanitizeProviderMessage } from '../src/failure';
import { hash, type Env } from '../src/security';
import type { GenerationAdapter } from '../src/providers';

const step:DurableStep={do:async(_name,_config,fn)=>fn(),sleep:async()=>{}};
const session='owner-session-token-123456789012345';
let db:DatabaseSync,env:Env;
beforeEach(async()=>{
  db=new DatabaseSync(':memory:');db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)");
  env={DB:adapter(db),ASSETS:memoryBucket().bucket,APP_ORIGIN:'http://localhost:3097'};
  await env.DB.prepare('INSERT INTO account_sessions VALUES (?,?,?)').bind(await hash(session),'owner',Date.now()+60_000).run();
});
afterEach(()=>{vi.restoreAllMocks();db.close();});

const job=(token='failure-token-0000000000000000')=>acceptJob(env,'owner',token,{provider:'local-test',modelId:'local-test',mediaType:'image',inputMode:'text',prompt:'test',values:{},referenceIds:[]});
const reason=async(id:string)=>db.prepare('SELECT failure_reason,failure_detail FROM account_jobs WHERE id=?').get(id);
const post=(path:string,body?:unknown)=>jobRoutes(new Request(`http://localhost:8797/api/account/jobs/${path}`,{method:'POST',headers:{cookie:`sa_session=${session}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);

/**
 * The defect: `captureResult` already distinguished six causes and the runner
 * flattened them into one `save_failed`, so the account page could only ever
 * say "needs another attempt" and offer a resume that repeated the same 404.
 */
it('records why saving failed instead of only that it did',async()=>{
  const j=await job();
  await env.DB.prepare("UPDATE account_jobs SET state='saving',provider_task='{}',result_json=? WHERE id=?")
    .bind(JSON.stringify({sources:[{url:'https://cometapi.com/gone.mp4'}]}),j.id).run();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status:404})));
  await runGeneration(env,j.id,step,{submit:vi.fn(),poll:vi.fn()});
  expect((await getJob(env,j.id))?.state).toBe('needs_attention');
  expect(await reason(j.id)).toMatchObject({failure_reason:'result_link_expired'});
});

it('keeps the specific reason when the coarse state transition follows it',async()=>{
  const j=await job();
  await env.DB.prepare("UPDATE account_jobs SET state='saving',provider_task='{}',result_json=? WHERE id=?")
    .bind(JSON.stringify({sources:[{url:'https://cometapi.com/gone.mp4'}]}),j.id).run();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status:404})));
  await runGeneration(env,j.id,step,{submit:vi.fn(),poll:vi.fn()});
  // `setJobState` coalesces on purpose: the outer catch runs after the step that
  // already knew this was a dead link, and a plain assignment would erase it.
  expect((await getJob(env,j.id))?.error_code).toBe('save_failed');
  expect(await reason(j.id)).toMatchObject({failure_reason:'result_link_expired'});
});

it('carries the provider’s own refusal onto the job',async()=>{
  const j=await job();
  await env.DB.prepare("UPDATE account_jobs SET state='running',provider_task=? WHERE id=?").bind('{"id":"task"}',j.id).run();
  const provider:GenerationAdapter={submit:vi.fn(),poll:vi.fn().mockResolvedValue({state:'failed',reason:'prompt violates content policy'})};
  await runGeneration(env,j.id,step,provider);
  expect((await getJob(env,j.id))?.error_code).toBe('provider_failed');
  expect(await reason(j.id)).toMatchObject({failure_reason:'provider_rejected',failure_detail:'prompt violates content policy'});
});

it('strips anything credential-shaped out of a provider message',()=>{
  // The only string in this pipeline we did not write. A vendor can echo the
  // request back, and the request carries a key.
  expect(sanitizeProviderMessage('rejected: Authorization: Bearer sk-live-abcdefghijklmnop')).toBe('rejected:');
  expect(sanitizeProviderMessage('failed fetching https://vendor.test/x?key=abc123 for task')).toBe('failed fetching for task');
  expect(sanitizeProviderMessage('token AKIAIOSFODNN7EXAMPLEKEYVALUE99')).toBe(null);
  // Long but ordinary prose is kept and capped; a single 400-character token
  // is credential-shaped and is dropped instead, which is the safe way round.
  expect(sanitizeProviderMessage('the model refused this request '.repeat(20))).toHaveLength(200);
  expect(sanitizeProviderMessage('a'.repeat(400))).toBe(null);
  expect(sanitizeProviderMessage(undefined)).toBe(null);
});

it('refuses to resume a cause that trying again cannot change',async()=>{
  const j=await job();
  await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',error_code='save_failed',failure_reason='result_link_expired',provider_task='{}',result_json='{}' WHERE id=?").bind(j.id).run();
  const response=await post(`${j.id}/resume`);
  expect(response?.status).toBe(409);
  expect(await response?.json()).toMatchObject({code:'unrecoverable'});
  // Untouched: a refusal must not consume an attempt or move the job.
  expect((await getJob(env,j.id))?.state).toBe('needs_attention');
});

it('retires resume after the attempt limit and clears the reason on a good one',async()=>{
  const j=await job();
  await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',error_code='save_failed',failure_reason='transfer_failed',provider_task='{}',result_json='{}',workflow_attempt=? WHERE id=?")
    .bind(MAX_RESUME_ATTEMPTS-1,j.id).run();
  expect((await post(`${j.id}/resume`))?.status).toBe(202);
  expect(await reason(j.id)).toMatchObject({failure_reason:null,failure_detail:null});

  await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',error_code='save_failed',failure_reason='transfer_failed' WHERE id=?").bind(j.id).run();
  const exhausted=await post(`${j.id}/resume`);
  expect(exhausted?.status).toBe(409);
  expect(await exhausted?.json()).toMatchObject({code:'resume_exhausted'});
});

it('stops tracking and removes the row in one request, releasing the reservation',async()=>{
  const j=await job();
  await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',error_code='save_failed' WHERE id=?").bind(j.id).run();
  const response=await post(`${j.id}/dismiss`,{remove:true});
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({removed:true});
  // The row is gone and the quota it held is back, from one confirmed action.
  expect(await getJob(env,j.id)).toBeNull();
  expect(db.prepare('SELECT deleted FROM account_jobs WHERE id=?').get(j.id)).toMatchObject({deleted:1});
  expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage').get()).toMatchObject({reserved_bytes:0,active_jobs:0});
});

it('leaves the row in place when a caller does not ask for removal',async()=>{
  // An older browser sends no body. It must still get the behaviour it renders,
  // because the two halves of this app deploy separately.
  const j=await job();
  await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',error_code='save_failed' WHERE id=?").bind(j.id).run();
  const response=await post(`${j.id}/dismiss`);
  expect(response?.status).toBe(200);
  expect(await getJob(env,j.id)).toMatchObject({state:'failed',error_code:'tracking_stopped'});
});
