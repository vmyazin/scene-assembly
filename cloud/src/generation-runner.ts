import { recordAccountSpend } from './spend';
import type { Env } from './security';
import { AccountError, finishJob, getJob, recordFailure, setJobState, type JobRow } from './jobs';
import { captureFailureReason, providerFailureReason, sanitizeProviderMessage } from './failure';
import { captureResult, type ProviderResult } from './assets';
import { adapterFor, type GenerationAdapter, type ProviderHandle } from './providers';

export interface DurableStep {
  do<T>(name:string,config:{retries:{limit:number;delay:string;backoff?:'exponential'|'constant'};timeout?:string},fn:()=>Promise<T>):Promise<T>;
  sleep(name:string,duration:string):Promise<void>;
}
const SAFE={retries:{limit:5,delay:'5 seconds',backoff:'exponential' as const},timeout:'5 minutes'};
const SINGLE={retries:{limit:0,delay:'1 second'},timeout:'5 minutes'};
export async function runGeneration(env:Env,jobId:string,step:DurableStep,override?:GenerationAdapter) {
  let job=await getJob(env,jobId);
  if(!job||['saved','failed','cancelled'].includes(job.state))return;
  try{
    // Saving persisted results needs neither a provider connection nor an
    // enabled submit adapter (both may have changed since generation finished).
    const adapter=()=>override||adapterFor(env,job!.provider);
    await step.do('submit',SINGLE,async()=>{
      const current=await getJob(env,jobId);
      if(!current||['saved','failed','cancelled'].includes(current.state)||current.provider_task||current.result_json)return;
      // A synchronous response may have reached R2 before D1 was committed.
      // Recover that object even though repeating the paid call is forbidden.
      if(current.state!=='queued' && adapter().recover){
        const recovered=await adapter().recover!(env,current);
        if(recovered){
          await env.DB.prepare("UPDATE account_jobs SET result_json=?,state='saving',updated_at=? WHERE id=? AND deleted=0 AND state NOT IN ('saved','failed','cancelled')").bind(JSON.stringify(recovered),Date.now(),jobId).run();
          return;
        }
      }
      // On replay after a process loss, submitting is ambiguous. Never charge again.
      if(current.state!=='queued')throw new Error('submission_ambiguous');
      const claimed=await env.DB.prepare("UPDATE account_jobs SET state = 'submitting', updated_at = ? WHERE id = ? AND state = 'queued' AND deleted = 0").bind(Date.now(),jobId).run();
      if(!claimed.meta.changes)throw new Error('submission_ambiguous');
      // Workflow errors may be persisted by the platform. Do not hand it raw
      // vendor response bodies or request details that could contain a key —
      // but classify first: this catch is the last place the thrown error still
      // carries its status and its code, and a provider that read the request
      // and refused it is a different thing to read on the row than one that
      // was never reached. What the vendor said reaches D1 only through
      // `sanitizeProviderMessage`, and never the Workflow's own error store.
      const result=await adapter().submit(env,current).catch(async error=>{
        const {reason,detail}=providerFailureReason(error);
        await recordFailure(env,jobId,reason,detail).catch(()=>{});
        throw new Error('Provider submission could not be confirmed');
      });
      if(!result.handle&&!result.result)throw new Error('submission_ambiguous');
      await env.DB.prepare("UPDATE account_jobs SET provider_task = ?, result_json = ?, state = ?, updated_at = ? WHERE id = ? AND deleted = 0 AND state NOT IN ('saved','failed','cancelled')")
        .bind(result.handle?JSON.stringify(result.handle):null,result.result?JSON.stringify(result.result):null,result.result?'saving':'running',Date.now(),jobId).run();
    });
    for(let attempt=0;attempt<120;attempt++){
      job=await getJob(env,jobId);
      if(!job||['saved','failed','cancelled'].includes(job.state))return;
      if(job.result_json)break;
      if(!job.provider_task)throw new Error('submission_ambiguous');
      const outcome=await step.do(`poll-${attempt}`,SAFE,async()=>{
        const current=await getJob(env,jobId);if(!current)return 'deleted';
        if(['saved','failed','cancelled'].includes(current.state))return 'terminal';
        const status=await adapter().poll(env,current,JSON.parse(current.provider_task!) as ProviderHandle).catch(async error=>{
          const {reason,detail}=providerFailureReason(error);
          await recordFailure(env,jobId,reason,detail).catch(()=>{});
          throw new Error('Provider status could not be read');
        });
        // The provider's own sentence — "prompt violates content policy",
        // "unsupported aspect ratio" — is the most actionable thing on the row
        // and was being dropped on the floor here. Every adapter already had
        // it; only the runner refused to carry it.
        if(status.state==='failed'){await finishJob(env,jobId,'failed','provider_failed',{reason:'provider_rejected',detail:sanitizeProviderMessage(status.reason)});return 'failed';}
        if(status.state==='success'){
          if(!status.result)throw new Error('Missing result');
          await env.DB.prepare("UPDATE account_jobs SET result_json = ?, state = 'saving', updated_at = ? WHERE id = ? AND deleted = 0 AND state NOT IN ('saved','failed','cancelled')").bind(JSON.stringify(status.result),Date.now(),jobId).run();
          return 'success';
        }
        return 'running';
      });
      if(outcome==='failed'||outcome==='deleted'||outcome==='terminal')return;
      if(outcome==='success')break;
      await step.sleep(`wait-${attempt}`,'15 seconds');
    }
    job=await getJob(env,jobId);
    if(!job)return;
    if(!job.result_json){await recordFailure(env,jobId,'provider_timeout');throw new Error('provider_timeout');}
    const capturedJob:JobRow=job;
    const saveOutcome=await step.do('save-assets',SAFE,async()=>{
      const current=await getJob(env,jobId);
      if(!current||['saved','failed','cancelled'].includes(current.state))return;
      try{
        await captureResult(env,capturedJob,JSON.parse(capturedJob.result_json!) as ProviderResult);
      }catch(error){
        // Classified here because this is the last place the `AccountError`
        // prototype is intact; past the step boundary only a flattened message
        // survives, which is how six distinct causes used to arrive at the
        // account page as one sentence about needing another attempt.
        const reason=captureFailureReason(error);
        await recordFailure(env,jobId,reason);
        // A full library needs a user decision, not transfer retries. Return a
        // serializable outcome instead of relying on a custom Error surviving
        // the Workflow boundary with its prototype and code intact.
        if(error instanceof AccountError&&error.code==='storage_full')return 'storage_full';
        // Neither does a link the provider has already expired, or a file over
        // the output cap. Returning ends the step instead of spending five
        // backed-off retries re-proving what the reason already says.
        if(reason!=='transfer_failed')return 'unrecoverable';
        throw new Error('Output transfer could not finish');
      }
      await finishJob(env,jobId,'saved');
      return 'saved';
    });
    if(saveOutcome==='storage_full')await setJobState(env,jobId,'needs_attention','storage_full');
    if(saveOutcome==='unrecoverable')await setJobState(env,jobId,'needs_attention','save_failed');
  }catch(error){
    const current=await getJob(env,jobId);
    // `setJobState` coalesces the reason columns, so whatever the failing step
    // already recorded survives this coarser update; the reason passed here is
    // only the fallback for a path that recorded nothing.
    if(current&&!['saved','failed','cancelled'].includes(current.state)){
      const storageFull=error instanceof AccountError&&error.code==='storage_full';
      const errorCode=storageFull?'storage_full':current.result_json?'save_failed':current.provider_task?'tracking_interrupted':'submission_ambiguous';
      const reason=storageFull?'storage_full':current.result_json?'transfer_failed':current.provider_task?'worker_interrupted':'submit_unconfirmed';
      await setJobState(env,jobId,'needs_attention',errorCode,{reason});
    }
  }finally{
    const completed=await getJob(env,jobId).catch(()=>null);
    if(completed)await recordAccountSpend(env,completed);
  }
}
