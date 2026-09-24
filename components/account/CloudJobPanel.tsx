'use client';
import { useRef, useState } from 'react';
import { Cloud, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ResultStack from '@/components/ResultStack';
import LastFrameActions from '@/components/LastFrameActions';
import ResultActions from '@/components/ResultActions';
import { saveCloudVideoToGallery } from '@/lib/timeline/import-cloud';
import { useTimelineStore } from '@/store/useTimelineStore';
import { knownAccountAssetFilenameBase } from '@/lib/account/asset-name';
import { useAccountStore } from '@/store/useAccountStore';
import { downloadAccountAsset } from '@/lib/account/download';
import { accountRequest } from '@/lib/account/client';
import { isListedJob , isActiveJob} from '@/lib/account/job-status';
import type { CloudAsset, CloudJobRequest, CloudJobView } from '@/lib/account/contracts';
import VideoPlayer from '@/components/video/VideoPlayer';
import JobElapsed from '@/components/JobElapsed';
import CloudJobList from './CloudJobList';
import { AccountSurface } from './AccountSurface';
import TemporaryAssetNotice from './TemporaryAssetNotice';
export default function CloudJobPanel({provider,modelId,mediaType,inputMode,onContinueFromFrame,resultJobId}:Pick<CloudJobRequest,'provider'|'modelId'|'mediaType'|'inputMode'> & {onContinueFromFrame?:()=>void;resultJobId?:string}) {
  const allJobs=useAccountStore(state=>state.jobs),allAssets=useAccountStore(state=>state.assets);
  const [error,setError]=useState<string|null>(null),[downloading,setDownloading]=useState<string|null>(null);
  // Images are one feed across every provider and model, the same as the local
  // panels (`useImageResultFeed`): a result is a result wherever it came from,
  // and each card names its source. Video stays scoped to the selection,
  // because that panel shows a single clip and it has to be the one just asked for.
  const inScope=(p:string,m:string,mode:string)=>mediaType==='image'||(p===provider&&m===modelId&&mode===inputMode);
  const jobs=allJobs.filter(j=>j.request.mediaType===mediaType&&inScope(j.provider,j.request.modelId,j.request.inputMode));
  const assets=allAssets.filter(a=>a.kind===mediaType&&inScope(a.metadata.provider,a.metadata.modelId,a.metadata.inputMode)&&(!resultJobId||a.jobId===resultJobId));
  const pending=useRef(false),[busy,setBusy]=useState(false);
  // `isActiveJob` rather than a fourth copy of the state list: the timer needs
  // the running job itself, and two answers to "is this in flight" on one line
  // is how they drift.
  const active=jobs.some(isActiveJob);
  /** Downloads the clip into the browser library, then places it — the same
   *  route the library's own card takes, so a placement resolves identically. */
  async function addClipToTimeline(asset:CloudAsset){
    const owner=useAccountStore.getState().session?.account?.id;
    if(!owner)throw new Error('Sign in again to add this clip to the timeline.');
    const recordId=await saveCloudVideoToGallery(asset,owner);
    useTimelineStore.getState().addClip(recordId);
    toast.success('Added to the timeline');
  }
  async function download(asset:CloudAsset){setDownloading(asset.id);try{await downloadAccountAsset(asset);}catch(error){setError(error instanceof Error?error.message:'Download failed.');}finally{setDownloading(null);}}
  async function changeJob(id:string,action:'resume'|'cancel'){
    if(pending.current)return;
    const {session,epoch}=useAccountStore.getState(),owner=session?.account?.id;
    if(!owner)return;
    pending.current=true;setBusy(true);setError(null);
    try{
      const response=await accountRequest<{job:typeof jobs[number]}>(`jobs/${id}/${action}`,{method:'POST',headers:{'X-Account-Id':owner}});
      const state=useAccountStore.getState();
      state.applyJobs(owner,epoch,state.jobs.map(job=>job.id===id?response.job:job),state.assets);
    }catch(error){setError(error instanceof Error?error.message:'Could not update this job.');}
    finally{pending.current=false;setBusy(false);}
  }
  /**
   * One path off the list, whether a row is stopped or still waiting.
   *
   * A job awaiting a decision is dismissed with `remove`, so the Worker
   * releases its reservation and hides the row in the same batch; anything
   * already terminal is simply deleted. They share a loop because they share an
   * outcome — the row is gone — and because "Clear" hands over every job at
   * once, sequentially and under one busy window.
   *
   * Rows are dropped locally rather than replaced, since this panel reads the
   * memory-only account store rather than refetching: applying the returned
   * `tracking_stopped` job would put the row straight back on screen, which is
   * the two-step behaviour this replaced.
   */
  async function clearJobs(targets:CloudJobView[]){
    if(pending.current)return;
    const {session,epoch}=useAccountStore.getState(),owner=session?.account?.id;
    if(!owner)return;
    pending.current=true;setBusy(true);setError(null);
    const removed:string[]=[];
    try{
      for(const job of targets){
        await (job.state==='needs_attention'
          ?accountRequest(`jobs/${job.id}/dismiss`,{method:'POST',headers:{'Content-Type':'application/json','X-Account-Id':owner},body:JSON.stringify({remove:true})})
          :accountRequest(`jobs/${job.id}`,{method:'DELETE',headers:{'X-Account-Id':owner}}));
        removed.push(job.id);
      }
    }catch(error){setError(error instanceof Error?error.message:'Could not update this job.');}
    finally{
      // Only what the Worker confirmed: a row left on screen after a failure is
      // recoverable, one hidden from a request that never landed is not.
      const state=useAccountStore.getState();
      if(removed.length)state.applyJobs(owner,epoch,state.jobs.filter(job=>!removed.includes(job.id)),state.assets);
      pending.current=false;setBusy(false);
    }
  }
  return <AccountSurface label="Account generation results" className="flex min-h-[420px] flex-col gap-4">
    <div><h3 className="display flex items-center gap-2 text-base font-semibold"><Cloud size={17} className="text-cyan-300" aria-hidden="true"/>Result</h3><p className="mt-1 text-xs text-[var(--foreground-muted)]">Saved to your account when complete. You can leave this page.</p></div>
    <CloudJobList jobs={jobs.filter(isListedJob)} busy={busy} onResume={id=>void changeJob(id,'resume')} onCancel={id=>void changeJob(id,'cancel')} onDismiss={id=>{const job=jobs.find(entry=>entry.id===id);if(job)void clearJobs([job]);}} onClear={targets=>void clearJobs(targets)} />
    <TemporaryAssetNotice assets={assets} />
    {mediaType==='image'?<ResultStack items={assets.map(a=>{
      // Timed by joining back to the job that made it, because the asset itself
      // stores only `createdAt`. Dismissing a job therefore drops the duration
      // while the image survives — `ResultMeta` omits what it is not told, so
      // that reads as one fact fewer rather than a broken row.
      const job=a.jobId?allJobs.find(j=>j.id===a.jobId):undefined;
      return {id:a.id,src:`/api/account/assets/${a.id}/content`,mimeType:a.mimeType,label:a.expiresAt?'Temporary result':undefined,provider:a.metadata.provider,modelId:a.metadata.modelId,createdAt:a.createdAt,startedAt:job?.createdAt,finishedAt:job?.updatedAt};
    })} isGenerating={active} pendingLabel="Your job is running." downloadingId={downloading} filenameBase={item=>{const asset=assets.find(a=>a.id===item.id);return asset?knownAccountAssetFilenameBase(asset):item.id;}} onUseAsFirstFrame={onContinueFromFrame} onDownload={item=>{const asset=assets.find(a=>a.id===item.id);if(asset)return download(asset);}} emptyState={<p className="p-5 text-center text-sm text-[var(--foreground-muted)]">Your saved images will appear here.</p>}/>:assets[0]?<><VideoPlayer crossOrigin label="Saved video" src={`/api/account/assets/${assets[0].id}/content`} className="w-full rounded-xl"/><button type="button" disabled={Boolean(downloading)} onClick={()=>void download(assets[0])} className="btn-secondary justify-center"><Download size={16} aria-hidden="true"/>Download video</button></>:<div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-[var(--foreground-muted)]">{active&&<Loader2 className="animate-spin text-cyan-300" aria-hidden="true"/>}{active?<span>Your background video job is running.{' '}<JobElapsed className="text-[var(--foreground)]" startedAt={jobs.find(isActiveJob)?.createdAt}/></span>:'Your saved video will appear here.'}</div>}
    {mediaType==='video'&&assets[0]&&<LastFrameActions key={assets[0].id} videoUrl={`/api/account/assets/${assets[0].id}/content`} filenameBase={knownAccountAssetFilenameBase(assets[0])} onContinue={onContinueFromFrame}/>}
    {/* The clip's other exits. `Continue from last frame` above is the one the
        app always had; these are the two it was missing — the frame as a
        reference, and the clip itself as a cut. */}
    {mediaType==='video'&&assets[0]&&<ResultActions key={`actions-${assets[0].id}`} kind="video" src={`/api/account/assets/${assets[0].id}/content`} filenameBase={knownAccountAssetFilenameBase(assets[0])} onAddToTimeline={()=>addClipToTimeline(assets[0])}/>}
    {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  </AccountSurface>;
}
