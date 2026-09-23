import { buildAccountSpendEntry, type AccountSpendEntry, type PersistedProviderResult } from '../../lib/spend/account';
import { totals as rollupTotals } from '../../lib/spend/rollup';
import { currentAccount } from './sessions';
import { json, type Env } from './security';
import type { JobRow } from './jobs';

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

export async function spendRoutes(request:Request,env:Env):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(!/^\/api\/account\/spend(?:\/|$)/.test(path))return null;
  const account=await currentAccount(request,env);
  if(!account)return json({error:'Sign in to access account spend.'},401);
  if(path==='/api/account/spend'&&request.method==='GET'){
    const cursor=new URL(request.url).searchParams.get('cursor');
    const match=cursor?.match(/^(\d+):([a-zA-Z0-9_-]+)$/);
    if(cursor&&!match)return json({error:'Invalid page cursor.'},400);
    const before=match?Number(match[1]):Number.MAX_SAFE_INTEGER,beforeId=match?match[2]:'~';
    const rows=await env.DB.prepare(`SELECT * FROM account_spend WHERE user_id=? AND deleted=0
      AND (at<? OR (at=? AND id<?)) ORDER BY at DESC,id DESC LIMIT 51`)
      .bind(account.id,before,before,beforeId).all<SpendRow>();
    const page=rows.results.slice(0,50),entries=page.map(entryView).filter((entry):entry is AccountSpendEntry=>entry!==null),last=page.at(-1);
    return json({accountId:account.id,entries,nextCursor:rows.results.length>50&&last?`${last.at}:${last.id}`:null});
  }
  if(path==='/api/account/spend/totals'&&request.method==='GET'){
    // Summed here rather than in the browser because the ledger is paged: a
    // client adding up the first page would under-report every account past
    // fifty runs. Walked in batches so a long ledger stays memory-bounded, and
    // reduced with the same pure rollup /spend uses — a SQL reimplementation of
    // the arithmetic would drift from it. `since` is the range start the /spend
    // page computes in the viewer's local time, so the Worker never has to
    // guess a timezone for "this month".
    const sinceParam=new URL(request.url).searchParams.get('since');
    if(sinceParam!==null&&!/^\d{1,15}$/.test(sinceParam))return json({error:'Invalid range start.'},400);
    const since=sinceParam===null?0:Number(sinceParam);
    const entries:AccountSpendEntry[]=[];
    let before=Number.MAX_SAFE_INTEGER,beforeId='~';
    for(let batch=0;batch<200;batch++){
      const rows=await env.DB.prepare(`SELECT id,at,entry_json FROM account_spend WHERE user_id=? AND deleted=0 AND at>=?
        AND (at<? OR (at=? AND id<?)) ORDER BY at DESC,id DESC LIMIT 500`)
        .bind(account.id,since,before,before,beforeId).all<SpendRow>();
      for(const row of rows.results){const entry=entryView(row);if(entry)entries.push(entry);}
      const last=rows.results.at(-1);
      if(rows.results.length<500||!last)break;
      before=last.at;beforeId=last.id;
    }
    return json({accountId:account.id,totals:rollupTotals(entries)});
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
