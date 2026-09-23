import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudJobRequest } from '../../lib/account/contracts';
import type { JobRow } from '../src/jobs';
import type { Env } from '../src/security';
import { hash } from '../src/security';
import { reconcileSpend, recordAccountSpend, spendRoutes } from '../src/spend';
import { aggregatorAdapter } from '../src/provider-adapters/aggregators';
import { saveConnection } from '../src/vault';
import { adapter } from './database';

const migration=(name:string)=>readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');
let db:DatabaseSync,env:Env;
const token='a'.repeat(32);

function request(provider:CloudJobRequest['provider']='runware'):CloudJobRequest {
  return {provider,modelId:provider==='runware'?'runware:z-image@turbo':'model',mediaType:'image',inputMode:'text',prompt:'A quiet blue room',values:{},referenceIds:[]};
}
function job(id:string,owner='owner',patch:Partial<JobRow>={}):JobRow {
  return {id,user_id:owner,provider:'runware',request_json:JSON.stringify(request()),state:'needs_attention',connection_id:null,connection_revision:null,provider_task:'{"id":"remote"}',result_json:JSON.stringify({sources:[{url:'https://example.invalid/result.png'}],cost:0.04}),error_code:'save_failed',reservation_bytes:1,reservation_accounted:0,request_digest:'digest',workflow_attempt:0,dispatched:1,deleted:0,created_at:10,updated_at:20,...patch};
}
function insertJob(row:JobRow){
  db.prepare(`INSERT INTO account_jobs (id,user_id,request_token,request_digest,connection_id,connection_revision,provider,request_json,state,provider_task,result_json,error_code,reservation_bytes,reservation_accounted,workflow_attempt,dispatched,deleted,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id,row.user_id,`token-${row.id}`,row.request_digest,row.connection_id,row.connection_revision,row.provider,row.request_json,row.state,row.provider_task,row.result_json,row.error_code,row.reservation_bytes,row.reservation_accounted,row.workflow_attempt,row.dispatched,row.deleted,row.created_at,row.updated_at);
}
async function api(path:string,method='GET',ownerToken=token){
  return spendRoutes(new Request(`http://localhost:8797/api/account/spend${path}`,{method,headers:{cookie:`__Host-sa_session=${ownerToken}`}}),env) as Promise<Response>;
}

beforeEach(async()=>{
  db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  db.exec(migration('0001_accounts.sql'));db.exec(migration('0002_connections.sql'));db.exec(migration('0003_jobs.sql'));db.exec(migration('0008_spend.sql'));db.exec(migration('0011_account_avatar.sql'));
  db.prepare("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google-owner','owner@example.test','Owner',1),('other','google-other','other@example.test','Other',1)").run();
  db.prepare('INSERT INTO account_sessions VALUES (?,?,?)').run(await hash(token),'owner',Date.now()+60_000);
  env={DB:adapter(db),APP_ORIGIN:'https://app.example.test',ACCOUNT_ENCRYPTION_VERSION:'1',ACCOUNT_ENCRYPTION_KEYS:JSON.stringify({'1':btoa('x'.repeat(32))})};
});
afterEach(()=>{vi.unstubAllGlobals();db.close();});

describe('persistent account spend',()=>{
  it('records a confirmed result idempotently even when asset saving failed',async()=>{
    const row=job('save-failed');insertJob(row);
    expect(await recordAccountSpend(env,row)).toBe(true);
    expect(await recordAccountSpend(env,row)).toBe(false);
    const saved=db.prepare('SELECT job_id,deleted,entry_json FROM account_spend').get() as {job_id:string;deleted:number;entry_json:string};
    expect(saved).toMatchObject({job_id:'save-failed',deleted:0});
    expect(JSON.parse(saved.entry_json)).toMatchObject({costUsd:0.04,confidence:'exact'});
  });

  it('reconciles only confirmed results and skips the free local fixture',async()=>{
    insertJob(job('paid'));
    insertJob(job('ambiguous','owner',{provider:'runware',result_json:null,error_code:'submission_ambiguous'}));
    insertJob(job('fixture','owner',{provider:'local-test',request_json:JSON.stringify(request('local-test')),result_json:JSON.stringify({sources:[{}]})}));
    expect(await reconcileSpend(env)).toBe(1);
    expect(db.prepare('SELECT job_id FROM account_spend').all()).toEqual([{job_id:'paid'}]);
  });

  it('keeps owners isolated and paginates without returning result URLs',async()=>{
    insertJob(job('mine'));insertJob(job('theirs','other'));
    await recordAccountSpend(env,job('mine'));await recordAccountSpend(env,job('theirs','other'));
    const response=await api('');
    expect(response.status).toBe(200);
    const body=await response.json() as {entries:Array<{id:string}>};
    expect(body.entries.map(entry=>entry.id)).toEqual(['runware-mine']);
    expect(JSON.stringify(body)).not.toContain('example.invalid');
  });

  it('totals the whole ledger from `since` onward without paging it to the browser',async()=>{
    for(let index=0;index<60;index++){const row=job(`run-${index}`,'owner',{updated_at:1_000+index});insertJob(row);await recordAccountSpend(env,row);}
    const theirs=job('theirs','other');insertJob(theirs);await recordAccountSpend(env,theirs);
    const all=await (await api('/totals')).json() as {totals:{runs:number;costUsd:number}};
    expect(all.totals.runs).toBe(60);
    expect(all.totals.costUsd).toBeCloseTo(2.4);
    const recent=await (await api('/totals?since=1050')).json() as {totals:{runs:number}};
    expect(recent.totals.runs).toBe(10);
    expect((await api('/totals?since=last-week')).status).toBe(400);
  });

  it('tombstones a deleted entry so reconciliation cannot restore it',async()=>{
    const row=job('remove-me');insertJob(row);await recordAccountSpend(env,row);
    expect((await api('/runware-remove-me','DELETE')).status).toBe(200);
    expect(await reconcileSpend(env)).toBe(0);
    expect(db.prepare('SELECT deleted FROM account_spend WHERE job_id=?').get('remove-me')).toEqual({deleted:1});
    await expect((await api('')).json()).resolves.toMatchObject({entries:[]});
  });

  it('cascades spend on account deletion while preserving it on job deletion',async()=>{
    const row=job('history');insertJob(row);await recordAccountSpend(env,row);
    db.prepare('DELETE FROM account_jobs WHERE id=?').run('history');
    expect(db.prepare('SELECT COUNT(*) AS count FROM account_spend').get()).toEqual({count:1});
    db.prepare('DELETE FROM account_users WHERE id=?').run('owner');
    expect(db.prepare('SELECT COUNT(*) AS count FROM account_spend').get()).toEqual({count:0});
  });

  it('preserves the Runware response cost in its durable provider result',async()=>{
    await saveConnection(env,'owner','runware',{apiKey:'runware-test-key'});
    const connection=db.prepare("SELECT id,revision FROM account_connections WHERE user_id='owner' AND provider='runware'").get() as {id:string;revision:number};
    const row=job('priced','owner',{connection_id:connection.id,connection_revision:connection.revision});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({data:[{imageURL:'https://im.runware.ai/result.png',cost:0.027}]})));
    const outcome=await aggregatorAdapter.poll(env,row,{id:'provider-task'});
    expect(outcome).toMatchObject({state:'success',result:{cost:0.027,sources:[{url:'https://im.runware.ai/result.png'}]}});
  });
});
