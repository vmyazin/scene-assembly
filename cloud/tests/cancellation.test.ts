import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob, cancelQueuedJob, dismissAttentionJob, getJob, IMAGE_RESERVATION } from '../src/jobs';
import { jobRoutes } from '../src/job-routes';
import { handleRequest } from '../src/index';
import { runGeneration, type DurableStep } from '../src/generation-runner';
import { hash, type Env } from '../src/security';
import type { GenerationAdapter } from '../src/providers';
import type { CloudJobRequest } from '../../lib/account/contracts';

const request:CloudJobRequest={provider:'local-test',modelId:'local-test',mediaType:'image',inputMode:'text',prompt:'cancel fixture',values:{},referenceIds:[]};
const step:DurableStep={do:async(_name,_config,fn)=>fn(),sleep:async()=>{}};
let db:DatabaseSync,env:Env;
const sessions={owner:'owner-session-token-123456789012345',other:'other-session-token-123456789012345'};

beforeEach(async()=>{
  db=new DatabaseSync(':memory:');db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google-owner','owner@example.test','Owner',1),('other','google-other','other@example.test','Other',1)");
  env={DB:adapter(db),APP_ORIGIN:'http://localhost:3097'};
  for(const [owner,token] of Object.entries(sessions))await env.DB.prepare('INSERT INTO account_sessions VALUES (?,?,?)').bind(await hash(token),owner,Date.now()+60_000).run();
});
afterEach(()=>{vi.restoreAllMocks();db.close();});

function cancelRequest(id:string,owner:keyof typeof sessions='owner'){
  return jobRoutes(new Request(`http://localhost:8797/api/account/jobs/${id}/cancel`,{method:'POST',headers:{cookie:`sa_session=${sessions[owner]}`}}),env);
}
function dismissRequest(id:string,owner:keyof typeof sessions='owner'){
  return jobRoutes(new Request(`http://localhost:8797/api/account/jobs/${id}/dismiss`,{method:'POST',headers:{cookie:`sa_session=${sessions[owner]}`}}),env);
}
function removeRequest(id:string,owner:keyof typeof sessions='owner'){
  return jobRoutes(new Request(`http://localhost:8797/api/account/jobs/${id}`,{method:'DELETE',headers:{cookie:`sa_session=${sessions[owner]}`}}),env);
}
function listRequest(owner:keyof typeof sessions='owner'){
  return jobRoutes(new Request('http://localhost:8797/api/account/jobs',{headers:{cookie:`sa_session=${sessions[owner]}`}}),env);
}
function resumeRequest(id:string){
  return jobRoutes(new Request(`http://localhost:8797/api/account/jobs/${id}/resume`,{method:'POST',headers:{cookie:`sa_session=${sessions.owner}`}}),env);
}
async function fixture(token='cancel-job-token-123456'){return acceptJob(env,'owner',token,request);}

describe('queued job cancellation',()=>{
  it('cancels a queued job and releases its reservation exactly once',async()=>{
    const job=await fixture();
    const response=await cancelRequest(job.id);
    expect(response?.status).toBe(200);
    expect((await response!.json()).job).toMatchObject({id:job.id,state:'cancelled',errorCode:null});
    expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:0,active_jobs:0});
    expect((await getJob(env,job.id))?.reservation_accounted).toBe(0);
  });

  it('returns the same cancelled job when cancellation is repeated',async()=>{
    const job=await fixture();
    const first=await cancelRequest(job.id),second=await cancelRequest(job.id);
    expect((await first!.json()).job).toEqual((await second!.json()).job);
    expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:0,active_jobs:0});
  });

  it('returns 409 without releasing quota after submission has claimed the job',async()=>{
    const job=await fixture();
    const claim=await env.DB.prepare("UPDATE account_jobs SET state='submitting' WHERE id=? AND state='queued'").bind(job.id).run();
    expect(claim.meta.changes).toBe(1);
    const response=await cancelRequest(job.id);
    expect(response?.status).toBe(409);
    expect(await response!.json()).toEqual({error:'This generation has already started and remains tracked.',code:'generation_started'});
    expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:IMAGE_RESERVATION,active_jobs:1});
  });

  it('hides jobs owned by another account',async()=>{
    const job=await fixture();
    const response=await cancelRequest(job.id,'other');
    expect(response?.status).toBe(404);
    expect(await response!.json()).toEqual({error:'Job not found.'});
  });

  it('makes an already-dispatched cancelled workflow a no-op',async()=>{
    const job=await fixture();await cancelQueuedJob(env,job.id,'owner');
    const provider:GenerationAdapter={recover:vi.fn(),submit:vi.fn(),poll:vi.fn()};
    await runGeneration(env,job.id,step,provider);
    expect(provider.recover).not.toHaveBeenCalled();expect(provider.submit).not.toHaveBeenCalled();expect(provider.poll).not.toHaveBeenCalled();
    expect((await getJob(env,job.id))?.state).toBe('cancelled');
  });

  it('allows only one winner when submission claim and cancellation race',async()=>{
    const job=await fixture();
    const cancellation=cancelQueuedJob(env,job.id,'owner');
    const claim=env.DB.prepare("UPDATE account_jobs SET state='submitting',updated_at=? WHERE id=? AND state='queued' AND deleted=0").bind(Date.now(),job.id).run();
    const [cancelResult,claimResult]=await Promise.allSettled([cancellation,claim]);
    const row=await getJob(env,job.id);
    expect(['cancelled','submitting']).toContain(row?.state);
    if(row?.state==='cancelled'){
      expect(cancelResult.status).toBe('fulfilled');
      expect(claimResult.status==='fulfilled'&&claimResult.value.meta.changes).toBe(0);
      expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:0,active_jobs:0});
    }else{
      expect(cancelResult.status).toBe('rejected');
      expect(claimResult.status==='fulfilled'&&claimResult.value.meta.changes).toBe(1);
      expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:IMAGE_RESERVATION,active_jobs:1});
    }
  });
});

describe('attention job dismissal',()=>{
  async function attention(token='attention-job-token-123456'){
    const job=await fixture(token);
    await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',error_code='submission_ambiguous' WHERE id=?").bind(job.id).run();
    return job;
  }

  it('stops tracking and releases quota exactly once, including repeated dismissal',async()=>{
    const job=await attention();
    const first=await dismissRequest(job.id),second=await dismissRequest(job.id);
    expect(first?.status).toBe(200);expect(second?.status).toBe(200);
    expect((await first!.json()).job).toMatchObject({id:job.id,state:'failed',errorCode:'tracking_stopped'});
    expect((await second!.json()).job).toMatchObject({id:job.id,state:'failed',errorCode:'tracking_stopped'});
    expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:0,active_jobs:0});
  });

  it('returns 404 for another owner and leaves the job tracked',async()=>{
    const job=await attention();
    const response=await dismissRequest(job.id,'other');
    expect(response?.status).toBe(404);
    expect((await getJob(env,job.id))?.state).toBe('needs_attention');
    expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:IMAGE_RESERVATION,active_jobs:1});
  });

  it('does not dismiss queued or actively tracked jobs',async()=>{
    const queued=await fixture('dismiss-queued-token-123456');
    const running=await fixture('dismiss-running-token-123456');
    await env.DB.prepare("UPDATE account_jobs SET state='running',provider_task=? WHERE id=?").bind(JSON.stringify({id:'active-task'}),running.id).run();
    for(const job of [queued,running]){
      const response=await dismissRequest(job.id);
      expect(response?.status).toBe(409);
      expect((await response!.json()).code).toBe('tracking_state_changed');
    }
    expect((await getJob(env,queued.id))?.state).toBe('queued');
    expect((await getJob(env,running.id))?.state).toBe('running');
    expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:2*IMAGE_RESERVATION,active_jobs:2});
  });

  it('rejects cross-origin dismissal before changing the job',async()=>{
    const job=await attention();
    const response=await handleRequest(new Request(`http://localhost:8797/api/account/jobs/${job.id}/dismiss`,{method:'POST',headers:{origin:'https://outside.example',cookie:`sa_session=${sessions.owner}`}}),env);
    expect(response.status).toBe(403);
    expect((await getJob(env,job.id))?.state).toBe('needs_attention');
  });

  it('preserves existing temporary assets and makes later workflows provider-free',async()=>{
    const job=await attention();const expiry=Date.now()+60_000;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO account_assets (id,user_id,job_id,object_key,kind,mime_type,bytes,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(`${job.id}-0`,'owner',job.id,`accounts/owner/jobs/${job.id}/0`,'image','image/png',3,job.request_json,1),
      env.DB.prepare('INSERT INTO account_asset_retention (asset_id,expires_at) VALUES (?,?)').bind(`${job.id}-0`,expiry),
    ]);
    await dismissAttentionJob(env,job.id,'owner');
    const provider:GenerationAdapter={recover:vi.fn(),submit:vi.fn(),poll:vi.fn()};
    await runGeneration(env,job.id,step,provider);
    expect(provider.recover).not.toHaveBeenCalled();expect(provider.submit).not.toHaveBeenCalled();expect(provider.poll).not.toHaveBeenCalled();
    expect(db.prepare('SELECT deleted FROM account_assets WHERE id=?').get(`${job.id}-0`)).toMatchObject({deleted:0});
    expect(db.prepare('SELECT expires_at FROM account_asset_retention WHERE asset_id=?').get(`${job.id}-0`)).toMatchObject({expires_at:expiry});
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_object_deletions').get()).toMatchObject({n:0});
  });

  it('lets either resume or dismissal claim attention without stale overwrites',async()=>{
    const job=await attention();
    await env.DB.prepare('UPDATE account_jobs SET provider_task=? WHERE id=?').bind(JSON.stringify({id:'provider-task'}),job.id).run();
    const [dismissed,resumed]=await Promise.all([dismissRequest(job.id),resumeRequest(job.id)]);
    const row=await getJob(env,job.id);
    expect(['failed','running']).toContain(row?.state);
    // Whichever request claimed the job answers with its own success code and
    // the loser gets 409: dismissal is 200, resume is 202 (accepted, the
    // workflow continues). Pinning [200,409] failed CI whenever resume won.
    expect([dismissed?.status,resumed?.status]).toEqual(row?.state==='failed'?[200,409]:[409,202]);
    if(row?.state==='failed'){
      expect(row.error_code).toBe('tracking_stopped');
      expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:0,active_jobs:0});
    }else{
      expect(row?.error_code).toBeNull();
      expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:IMAGE_RESERVATION,active_jobs:1});
    }
  });
});

describe('finished job removal',()=>{
  async function stopped(token='removable-job-token-123456'){
    const job=await fixture(token);
    await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',error_code='submission_ambiguous' WHERE id=?").bind(job.id).run();
    await dismissAttentionJob(env,job.id,'owner');
    return job;
  }

  it('removes a stopped job from the list while keeping its row for object cleanup',async()=>{
    const job=await stopped();
    const response=await removeRequest(job.id);
    expect(response?.status).toBe(200);
    expect((await listRequest().then(r=>r!.json())).jobs).toHaveLength(0);
    // Soft delete: `cleanupTerminalJobObjects` joins this row to sweep staged
    // provider objects, so losing it would strand a late R2 write.
    expect(db.prepare('SELECT deleted,state FROM account_jobs WHERE id=?').get(job.id)).toMatchObject({deleted:1,state:'failed'});
  });

  it('removes a cancelled job and reports a second removal as gone',async()=>{
    const job=await fixture('removable-cancelled-token-123456');
    await cancelQueuedJob(env,job.id,'owner');
    expect((await removeRequest(job.id))?.status).toBe(200);
    expect((await removeRequest(job.id))?.status).toBe(404);
  });

  it('refuses to remove a job that still holds a reservation',async()=>{
    const queued=await fixture('remove-queued-token-123456');
    const attention=await fixture('remove-attention-token-123456');
    await env.DB.prepare("UPDATE account_jobs SET state='needs_attention',error_code='submission_ambiguous' WHERE id=?").bind(attention.id).run();
    for(const job of [queued,attention]){
      const response=await removeRequest(job.id);
      expect(response?.status).toBe(409);
      expect((await response!.json()).code).toBe('job_not_finished');
    }
    expect((await getJob(env,queued.id))?.state).toBe('queued');
    expect((await getJob(env,attention.id))?.state).toBe('needs_attention');
    expect(db.prepare('SELECT reserved_bytes,active_jobs FROM account_storage WHERE user_id=?').get('owner')).toMatchObject({reserved_bytes:2*IMAGE_RESERVATION,active_jobs:2});
  });

  it('returns 404 for another owner and leaves the job listed',async()=>{
    const job=await stopped();
    expect((await removeRequest(job.id,'other'))?.status).toBe(404);
    expect(db.prepare('SELECT deleted FROM account_jobs WHERE id=?').get(job.id)).toMatchObject({deleted:0});
  });

  it('rejects cross-origin removal before touching the job',async()=>{
    const job=await stopped();
    const response=await handleRequest(new Request(`http://localhost:8797/api/account/jobs/${job.id}`,{method:'DELETE',headers:{origin:'https://outside.example',cookie:`sa_session=${sessions.owner}`}}),env);
    expect(response.status).toBe(403);
    expect(db.prepare('SELECT deleted FROM account_jobs WHERE id=?').get(job.id)).toMatchObject({deleted:0});
  });

  it('keeps the assets a removed job saved',async()=>{
    const job=await stopped('removable-with-asset-token-123456');
    await env.DB.prepare('INSERT INTO account_assets (id,user_id,job_id,object_key,kind,mime_type,bytes,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(`${job.id}-0`,'owner',job.id,`accounts/owner/jobs/${job.id}/0`,'image','image/png',3,job.request_json,1).run();
    expect((await removeRequest(job.id))?.status).toBe(200);
    expect(db.prepare('SELECT deleted FROM account_assets WHERE id=?').get(`${job.id}-0`)).toMatchObject({deleted:0});
  });
});
