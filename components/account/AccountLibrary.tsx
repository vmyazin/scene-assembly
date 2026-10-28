'use client';

import { useEffect, useRef, useState } from 'react';
import { Cloud } from 'lucide-react';
import { accountRequest } from '@/lib/account/client';
import { formatAccountBytes as size, useAccountLibrary, type ModelFilter } from '@/lib/account/use-library';
import type { RatingFilter } from '@/lib/results/rating';
import RatingFilterBar from '@/components/RatingFilterBar';
import { useAccountStore } from '@/store/useAccountStore';
import { isActiveJob, isListedJob } from '@/lib/account/job-status';
import type { CloudAssetCounts, CloudJobView } from '@/lib/account/contracts';
import CloudJobCardGrid from './CloudJobCardGrid';
import CloudJobList from './CloudJobList';
import CloudAssetGrid from './CloudAssetGrid';
import { AccountSurface } from './AccountSurface';
import type { VideoEditCapability } from '@/lib/providers/video-edit';

export default function AccountLibrary({localTest=false,ownerId,mode='browse',referenceLimit,onUsedReference,onAddedToTimeline,onPickVideo,editCapability,onCounts,onOpenStudio}: {
  localTest?:boolean;ownerId:string;mode?:'browse'|'pick-image'|'pick-clip';referenceLimit?:number;onUsedReference?:()=>void;
  onAddedToTimeline?:()=>void;
  onPickVideo?:(file:File)=>Promise<void>;
  /** Passed through so a Kling edit can pick a clip the 100 MB application cap would refuse. */
  editCapability?:Pick<VideoEditCapability,'mimes'|'maxBytes'>;
  /** Account-wide asset counts, for a host that labels this library from outside it. */
  onCounts?:(counts:CloudAssetCounts)=>void;
  /** Opens the studio where "Reuse settings" selected an asset's model. */
  onOpenStudio?:(href:string)=>void;
}) {
  const [rating,setRating]=useState<RatingFilter>('all'),[model,setModel]=useState<ModelFilter|null>(null),[grouped,setGrouped]=useState(false);
  // Pickers choose an input; narrowing them by rating would hide most of them.
  const browsing=mode==='browse';
  const library=useAccountLibrary(ownerId,onPickVideo?'video':'all',browsing?{rating,model}:{});
  const {jobs,assets,storage,cursor,nextCursor,loading,counts}=library;
  useEffect(()=>{if(counts)onCounts?.(counts);},[counts,onCounts]);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const pending=useRef(false);
  async function action(path:string,body?:unknown){
    if(pending.current)return;
    pending.current=true;
    setBusy(true);setError(null);
    try{
      if(ownerId!==useAccountStore.getState().session?.account?.id)throw new Error('Your account changed. Try again from the current library.');
      await accountRequest(path,{method:'POST',headers:{'Content-Type':'application/json','X-Account-Id':ownerId},...(body?{body:JSON.stringify(body)}:{})});
      if(ownerId===useAccountStore.getState().session?.account?.id)library.refresh();
    }
    catch(error){setError(error instanceof Error?error.message:'Please try again.');}
    finally{pending.current=false;setBusy(false);}
  }
  /** One path off the list for both halves of what used to be two steps: a job
   *  still awaiting a decision is dismissed with `remove`, so the Worker
   *  releases its reservation and hides the row in one batch, and anything
   *  already terminal is deleted. Sequential and inside one busy window:
   *  "Clear" passes every job at once, and `action` would drop all but the
   *  first to its own re-entry guard. */
  async function clearJobs(targets:CloudJobView[]){
    if(pending.current)return;
    pending.current=true;
    setBusy(true);setError(null);
    try{
      for(const job of targets){
        if(ownerId!==useAccountStore.getState().session?.account?.id)throw new Error('Your account changed. Try again from the current library.');
        await (job.state==='needs_attention'
          ?accountRequest(`jobs/${job.id}/dismiss`,{method:'POST',headers:{'Content-Type':'application/json','X-Account-Id':ownerId},body:JSON.stringify({remove:true})})
          :accountRequest(`jobs/${job.id}`,{method:'DELETE',headers:{'X-Account-Id':ownerId}}));
      }
    }
    catch(error){setError(error instanceof Error?error.message:'Please try again.');}
    finally{if(ownerId===useAccountStore.getState().session?.account?.id)library.refresh();pending.current=false;setBusy(false);}
  }
  return <AccountSurface label="Cloud library" className="mt-5">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Cloud size={18} className="text-[var(--neon-cyan)]" aria-hidden="true"/>Cloud library</h2>
    {storage&&<div className="mt-4"><div className="flex justify-between gap-2 text-sm"><span>{size(storage.usedBytes)} saved</span><span className="text-[var(--foreground-muted)]">1 GB included</span></div><div role="meter" aria-valuemin={0} aria-valuemax={storage.limitBytes} aria-valuenow={Math.min(storage.limitBytes,storage.usedBytes+storage.reservedBytes)} aria-valuetext={`${size(storage.usedBytes)} saved, ${size(storage.reservedBytes)} reserved`} aria-label="Cloud storage used and reserved" className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10"><span className="bg-[var(--neon-cyan)] transition-[width] duration-300 motion-reduce:transition-none" style={{width:`${Math.min(100,storage.usedBytes/storage.limitBytes*100)}%`}}/><span className="bg-violet-400/70 transition-[width] duration-300 motion-reduce:transition-none" style={{width:`${Math.min(100,storage.reservedBytes/storage.limitBytes*100)}%`}}/></div><p className="mt-2 text-xs text-[var(--foreground-muted)]">{size(storage.reservedBytes)} reserved for active jobs</p></div>}
    {localTest&&mode==='browse'&&<button disabled={busy} type="button" className="btn-secondary mt-4 w-full" onClick={()=>void action('jobs',{token:crypto.randomUUID(),request:{provider:'local-test',modelId:'local-test',mediaType:'image',inputMode:'text',prompt:'Local background test',values:{},referenceIds:[]}})}>Run local background test</button>}
    {/* Work in flight is this library's own content arriving, so it is drawn as
        the card it will become, at the grid's own width; only what waits on a
        person or has stopped stays a row. The pickers show neither: a running
        job is not something to attach. */}
    {mode==='browse'&&jobs.some(isActiveJob)&&<div className="mt-5"><CloudJobCardGrid jobs={jobs.filter(isActiveJob)} columns={2} busy={busy} onCancel={id=>void action(`jobs/${id}/cancel`)}/></div>}
    {mode==='browse'&&<div className="mt-5"><CloudJobList jobs={jobs.filter(job=>isListedJob(job)&&!isActiveJob(job))} limit={10} busy={busy} onResume={id=>void action(`jobs/${id}/resume`)} onCancel={id=>void action(`jobs/${id}/cancel`)} onDismiss={id=>{const job=jobs.find(entry=>entry.id===id);if(job)void clearJobs([job]);}} onClear={targets=>void clearJobs(targets)}/></div>}
    {browsing&&<RatingFilterBar counts={counts?.ratings??null} rating={rating} onRating={setRating} models={counts?.models??[]} model={model} onModel={choice=>setModel(choice as ModelFilter|null)} grouped={grouped} onGrouped={setGrouped} groupNote={cursor||nextCursor?'Groups cover the 50 results on this page.':undefined}/>}
    <div className="mt-5">{loading?<p role="status" className="py-6 text-center text-sm text-[var(--foreground-muted)]">Loading cloud assets…</p>:<CloudAssetGrid assets={assets} ownerId={ownerId} mode={mode} referenceLimit={referenceLimit} onUsedReference={onUsedReference} onAddedToTimeline={onAddedToTimeline} onPickVideo={onPickVideo} editCapability={editCapability} onChanged={library.refresh} onRated={library.replaceAsset} onOpenStudio={onOpenStudio} grouped={grouped} emptyMessage={rating!=='all'||model?'Nothing matches these filters.':undefined}/>}</div>
    {(cursor||nextCursor)&&<div className="mt-4 flex justify-between gap-2">{cursor&&<button type="button" disabled={loading} className="btn-secondary" onClick={()=>library.page(null)}>Latest assets</button>}{nextCursor&&<button type="button" disabled={loading} className="btn-secondary" onClick={()=>library.page(nextCursor)}>Older assets</button>}</div>}
    {(error||library.error)&&<div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p role="alert" className="text-sm text-red-300">{error||library.error}</p>{library.error&&<button type="button" disabled={loading} className="btn-secondary" onClick={library.refresh}>Try again</button>}</div>}
  </AccountSurface>;
}
