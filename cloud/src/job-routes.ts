import { mediaAccess } from './media';
export { byteRange } from './range';
import { currentAccount } from './sessions';
import { json, type Env } from './security';
import { acceptJob, AccountError, cancelQueuedJob, dismissAttentionJob, dispatchJob, getJob, jobView, removeFinishedJob, type JobRow } from './jobs';
import { adapterFor, validateRequest } from './providers';
import { isRecoverable, MAX_RESUME_ATTEMPTS } from './failure';
import { assetView, deleteAsset, getAsset } from './assets';

export async function jobRoutes(request:Request,env:Env):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(!/^\/api\/account\/(jobs|assets|storage)(\/|$)/.test(path))return null;
  const account=await currentAccount(request,env);
  if(!account)return json({error:'Sign in to access your cloud workspace.'},401);
  try{
    if(path==='/api/account/storage'&&request.method==='GET'){
      const storage=await env.DB.prepare('SELECT limit_bytes AS limitBytes, used_bytes AS usedBytes, reserved_bytes AS reservedBytes, active_jobs AS activeJobs FROM account_storage WHERE user_id = ?').bind(account.id).first();
      return json({storage:storage||{limitBytes:1_000_000_000,usedBytes:0,reservedBytes:0,activeJobs:0}});
    }
    if(path==='/api/account/jobs'&&request.method==='POST'){
      const text=await request.text();if(text.length>40000)return json({error:'Request is too large.'},413);
      const body=JSON.parse(text);
      if(!body||typeof body!=='object')return json({error:'Invalid request.'},400);
      const settings=validateRequest(env,body.request);
      const job=await acceptJob(env,account.id,body.token,settings);
      // Acceptance is durable even when dispatch fails. Scheduled reconciliation repairs it.
      if(!job.dispatched)await dispatchJob(env,job).catch(()=>{});
      return json({job:jobView(job)},202);
    }
    if(path==='/api/account/jobs'&&request.method==='GET'){
      const rows=await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 100').bind(account.id).all<JobRow>();
      return json({accountId:account.id,jobs:rows.results.map(jobView)});
    }
    const jobMatch=path.match(/^\/api\/account\/jobs\/([a-zA-Z0-9-]+)(\/(?:resume|cancel|dismiss))?$/);
    if(jobMatch){
      const job=await getJob(env,jobMatch[1],account.id);if(!job)return json({error:'Job not found.'},404);
      if(request.method==='GET'&&!jobMatch[2])return json({job:jobView(job)});
      // Removal is the last step of a finished job, never a way out of a live
      // one: `removeFinishedJob` rejects anything still holding a reservation.
      if(request.method==='DELETE'&&!jobMatch[2]){await removeFinishedJob(env,job.id,account.id);return json({ok:true});}
      if(request.method==='POST'&&jobMatch[2]==='/cancel'){
        const cancelled=await cancelQueuedJob(env,job.id,account.id);
        if(!cancelled)return json({error:'Job not found.'},404);
        return json({job:jobView(cancelled)});
      }
      if(request.method==='POST'&&jobMatch[2]==='/dismiss'){
        // `remove` is opt-in from the body rather than the default, so the two
        // halves of this app can deploy in either order: an older browser that
        // sends nothing still gets the two-step behaviour it knows how to
        // render, and a newer one talking to an older Worker has its flag
        // ignored rather than rejected.
        const body=await request.text().then(text=>text?JSON.parse(text):{}).catch(()=>{throw new AccountError('Invalid request.',400,'invalid_request');});
        const dismissed=await dismissAttentionJob(env,job.id,account.id,body?.remove===true);
        if(!dismissed)return json({error:'Job not found.'},404);
        return json({job:jobView(dismissed),removed:body?.remove===true});
      }
      if(request.method==='POST'&&jobMatch[2]==='/resume'){
        let recovered=false;
        if(job.state==='needs_attention'&&!job.provider_task&&!job.result_json){
          const result=await adapterFor(env,job.provider).recover?.(env,job);
          if(result){
            job.result_json=JSON.stringify(result);
            recovered=true;
            await env.DB.prepare("UPDATE account_jobs SET result_json=? WHERE id=? AND state='needs_attention' AND deleted=0").bind(job.result_json,job.id).run();
          }
        }
        if(job.state!=='needs_attention'||(!job.provider_task&&!job.result_json))return json({error:'This submission needs provider reconciliation before it can be resumed.'},409);
        // Two refusals the account page used to make people discover by
        // clicking. A provider link that has expired answers the same way on
        // every attempt, so resuming is not a slower path to the result — it is
        // the same failure with a fresh timestamp. A recovery that just found a
        // staged output is exempt: the reason on the row describes the
        // submission that was lost, not the save that is now possible.
        if(!recovered&&!isRecoverable(job.failure_reason))return json({error:'This result cannot be recovered by trying again. Stop tracking the job to clear it.',code:'unrecoverable'},409);
        if(job.workflow_attempt>=MAX_RESUME_ATTEMPTS)return json({error:`This job has already been resumed ${MAX_RESUME_ATTEMPTS} times without finishing. Stop tracking it to clear it.`,code:'resume_exhausted'},409);
        const claimed=await env.DB.prepare("UPDATE account_jobs SET state = ?, workflow_attempt = workflow_attempt + 1, dispatched = 0, error_code = NULL, failure_reason = NULL, failure_detail = NULL WHERE id = ? AND state = 'needs_attention'").bind(job.result_json?'saving':'running',job.id).run();
        if(!claimed.meta.changes)return json({error:'This generation is no longer waiting for a tracking decision.',code:'tracking_state_changed'},409);
        const resumed=await getJob(env,job.id,account.id);
        if(resumed)await dispatchJob(env,resumed).catch(()=>{});
        return json({job:jobView(resumed!)},202);
      }
    }
    if(path==='/api/account/assets'&&request.method==='GET'){
      const params=new URL(request.url).searchParams;
      const cursor=params.get('cursor');
      const kind=params.get('kind');
      if(kind!==null&&kind!=='image'&&kind!=='video')return json({error:'Unsupported media filter.'},400);
      const temporaryOnly=params.get('temporary')==='1';
      const match=cursor?.match(/^(\d+):([a-zA-Z0-9-]+)$/);
      if(cursor&&!match)return json({error:'Invalid page cursor.'},400);
      const before=match?Number(match[1]):Number.MAX_SAFE_INTEGER;
      const beforeId=match?match[2]:'~';
      const now=Date.now();
      const rows=await env.DB.prepare('SELECT a.*,r.expires_at FROM account_assets a LEFT JOIN account_asset_retention r ON r.asset_id=a.id WHERE a.user_id = ? AND a.deleted = 0 AND (r.expires_at IS NULL OR r.expires_at>?) AND (? IS NULL OR a.kind = ?) AND (? = 0 OR r.expires_at IS NOT NULL) AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?)) ORDER BY a.created_at DESC, a.id DESC LIMIT 51').bind(account.id,now,kind,kind,temporaryOnly?1:0,before,before,beforeId).all<Parameters<typeof assetView>[0]>();
      const page=rows.results.slice(0,50), last=page.at(-1);
      // Counts deliberately ignore both the cursor and the active filter. A
      // count that shrank as you paged, or that only described the current
      // filter, would make the pills lie about what is behind them.
      const counts=await env.DB.prepare(`SELECT COUNT(*) AS all_count,
          SUM(CASE WHEN a.kind='image' THEN 1 ELSE 0 END) AS image_count,
          SUM(CASE WHEN a.kind='video' THEN 1 ELSE 0 END) AS video_count,
          SUM(CASE WHEN r.expires_at IS NOT NULL THEN 1 ELSE 0 END) AS temporary_count
        FROM account_assets a LEFT JOIN account_asset_retention r ON r.asset_id=a.id
        WHERE a.user_id = ? AND a.deleted = 0 AND (r.expires_at IS NULL OR r.expires_at>?)`)
        .bind(account.id,now).first<{all_count:number;image_count:number|null;video_count:number|null;temporary_count:number|null}>();
      return json({accountId:account.id,assets:page.map(assetView),nextCursor:rows.results.length>50&&last?`${last.created_at}:${last.id}`:null,
        counts:{all:counts?.all_count??0,image:counts?.image_count??0,video:counts?.video_count??0,temporary:counts?.temporary_count??0}});
    }
    const assetMatch=path.match(/^\/api\/account\/assets\/([a-zA-Z0-9-]+)(\/(?:content|access))?$/);
    if(assetMatch){
      const asset=await getAsset(env,assetMatch[1],account.id);if(!asset)return json({error:'Asset not found.'},404);
      if(request.method==='DELETE'&&!assetMatch[2]){await deleteAsset(env,asset.id,account.id);return json({ok:true});}
      if(request.method==='POST'&&assetMatch[2]==='/access')return json(await mediaAccess(env,account.id,asset.id,'download'));
      if(request.method==='GET'&&assetMatch[2]==='/content'){
        const access=await mediaAccess(env,account.id,asset.id,'download');
        return new Response(null,{status:302,headers:{Location:access.url,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
      }
    }
    return json({error:'Not found.'},404);
  }catch(error){if(error instanceof AccountError)return json({error:error.message,code:error.code},error.status);if(error instanceof SyntaxError)return json({error:'Invalid request.'},400);throw error;}
}
