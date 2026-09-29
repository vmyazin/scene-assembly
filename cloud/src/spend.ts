import { buildAccountSpendEntry, type AccountSpendEntry, type PersistedProviderResult } from '../../lib/spend/account';
import { totals as rollupTotals } from '../../lib/spend/rollup';
import { currentAccount } from './sessions';
import { json, type Env } from './security';
import { AccountError, type JobRow } from './jobs';
import { settleCharge } from './mcp/budget';

interface SpendRow { id:string; user_id:string; job_id:string; entry_json:string; at:number; deleted:number }

/** Records a confirmed provider result once. It is deliberately best-effort. */
export async function recordAccountSpend(env:Env,job:JobRow):Promise<boolean> {
  try {
    if(!job.result_json||job.provider==='local-test')return false;
    const result=JSON.parse(job.result_json) as PersistedProviderResult;
    if(!Array.isArray(result.sources)||result.sources.length===0)return false;
    const first=await env.DB.prepare('SELECT id FROM account_assets WHERE user_id=? AND job_id=? AND deleted=0 ORDER BY created_at,id LIMIT 1').bind(job.user_id,job.id).first<{id:string}>();
    const entry=buildAccountSpendEntry({jobId:job.id,request:JSON.parse(job.request_json),result,at:job.updated_at,...(first?{firstAssetId:first.id}:{})});
    if(!entry)return false;
    const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO account_spend (id,user_id,job_id,entry_json,at)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM account_users WHERE id=?)`)
      .bind(entry.id,job.user_id,job.id,JSON.stringify(entry),entry.at,job.user_id).run();
    // An agent's reservation becomes the ledger's figure. Idempotent, so the
    // reconcile pass repeating it for an already-recorded job changes nothing.
    // Isolated: the spend row above is already committed, so a settle failure
    // (e.g. the charge or its table is gone) must not report that committed
    // insert as unrecorded — reconcileSpend only retries jobs with no
    // account_spend row, so a `false` here would hide a real spend entry
    // from reconciliation forever, not just delay its settle.
    try { await settleCharge(env, job.id, entry); } catch { /* best-effort settle; see comment above */ }
    return Boolean(inserted.meta.changes);
  } catch {
    return false;
  }
}

/** Repairs captures missed after result persistence, including save failures. */
export async function reconcileSpend(env:Env):Promise<number> {
  try {
    const rows=await env.DB.prepare(`SELECT j.* FROM account_jobs j
      LEFT JOIN account_spend s ON s.job_id=j.id
      WHERE j.result_json IS NOT NULL AND j.provider!='local-test' AND s.job_id IS NULL
      ORDER BY j.updated_at ASC LIMIT 100`).all<JobRow>();
    let recorded=0;
    for(const job of rows.results)if(await recordAccountSpend(env,job))recorded++;
    return recorded;
  } catch {
    return 0;
  }
}

function entryView(row:SpendRow):AccountSpendEntry|null {
  try{return JSON.parse(row.entry_json) as AccountSpendEntry;}catch{return null;}
}

export async function listSpend(env:Env,owner:string,cursor:string|null) {
  const match=cursor?.match(/^(\d+):([a-zA-Z0-9_-]+)$/);
  if(cursor&&!match)throw new AccountError('Invalid page cursor.',400,'invalid_request');
  const before=match?Number(match[1]):Number.MAX_SAFE_INTEGER,beforeId=match?match[2]:'~';
  const rows=await env.DB.prepare(`SELECT * FROM account_spend WHERE user_id=? AND deleted=0
    AND (at<? OR (at=? AND id<?)) ORDER BY at DESC,id DESC LIMIT 51`)
    .bind(owner,before,before,beforeId).all<SpendRow>();
  const page=rows.results.slice(0,50),entries=page.map(entryView).filter((entry):entry is AccountSpendEntry=>entry!==null),last=page.at(-1);
  return {entries,nextCursor:rows.results.length>50&&last?`${last.at}:${last.id}`:null};
}
export async function spendTotals(env:Env,owner:string,since=0) {
  // Summed here rather than in the browser because the ledger is paged: a
  // client adding up the first page would under-report every account past
  // fifty runs. Walked in batches so a long ledger stays memory-bounded, and
  // reduced with the same pure rollup /spend uses — a SQL reimplementation of
  // the arithmetic would drift from it. `since` is the range start the /spend
  // page computes in the viewer's local time, so the Worker never has to
  // guess a timezone for "this month".
  const entries:AccountSpendEntry[]=[];
  let before=Number.MAX_SAFE_INTEGER,beforeId='~';
  for(let batch=0;batch<200;batch++){
    const rows=await env.DB.prepare(`SELECT id,at,entry_json FROM account_spend WHERE user_id=? AND deleted=0 AND at>=?
      AND (at<? OR (at=? AND id<?)) ORDER BY at DESC,id DESC LIMIT 500`)
      .bind(owner,since,before,before,beforeId).all<SpendRow>();
    for(const row of rows.results){const entry=entryView(row);if(entry)entries.push(entry);}
    const last=rows.results.at(-1);
    if(rows.results.length<500||!last)break;
    before=last.at;beforeId=last.id;
  }
  return rollupTotals(entries);
}

export async function spendRoutes(request:Request,env:Env):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(!/^\/api\/account\/spend(?:\/|$)/.test(path))return null;
  const account=await currentAccount(request,env);
  if(!account)return json({error:'Sign in to access account spend.'},401);
  if(path==='/api/account/spend'&&request.method==='GET'){
    try{return json({accountId:account.id,...await listSpend(env,account.id,new URL(request.url).searchParams.get('cursor'))});}
    catch(error){if(error instanceof AccountError)return json({error:error.message},error.status);throw error;}
  }
  if(path==='/api/account/spend/totals'&&request.method==='GET'){
    const sinceParam=new URL(request.url).searchParams.get('since');
    if(sinceParam!==null&&!/^\d{1,15}$/.test(sinceParam))return json({error:'Invalid range start.'},400);
    const since=sinceParam===null?0:Number(sinceParam);
    return json({accountId:account.id,totals:await spendTotals(env,account.id,since)});
  }
  if(path==='/api/account/spend/all'&&request.method==='DELETE'){
    await env.DB.prepare('UPDATE account_spend SET deleted=1 WHERE user_id=? AND deleted=0').bind(account.id).run();
    return json({ok:true});
  }
  const match=path.match(/^\/api\/account\/spend\/([a-zA-Z0-9_-]+)$/);
  if(match&&request.method==='DELETE'){
    const changed=await env.DB.prepare('UPDATE account_spend SET deleted=1 WHERE id=? AND user_id=? AND deleted=0').bind(match[1],account.id).run();
    if(!changed.meta.changes)return json({error:'Spend entry not found.'},404);
    return json({ok:true});
  }
  return json({error:'Not found.'},404);
}
