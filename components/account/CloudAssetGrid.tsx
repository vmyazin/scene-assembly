'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, ImageDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import ImageLightbox from '@/components/ImageLightbox';
import FinalizeDraftButton from '@/components/FinalizeDraftButton';
import { submitSeedanceFinalize } from '@/lib/account/finalize-draft';
import { seedanceDraftSeconds } from '@/lib/providers/seedance-draft';
import { videoFileFromAccount } from '@/lib/account/video-source';
import type { VideoEditCapability } from '@/lib/providers/video-edit';
import { accountRequest } from '@/lib/account/client';
import type { CloudAsset } from '@/lib/account/contracts';
import { downloadAccountAsset } from '@/lib/account/download';
import { addAccountAssetAsReference } from '@/lib/account/reference';
import { formatAccountBytes } from '@/lib/account/use-library';
import { formatClock, watchUrl } from '@/lib/youtube/clip';
import { saveCloudVideoToGallery } from '@/lib/timeline/import-cloud';
import { useAccountStore } from '@/store/useAccountStore';
import { placeClipOnTimeline } from '@/lib/timeline/place-clip';
import VideoPlayer from '@/components/video/VideoPlayer';
import { libraryGridClass } from './library-grid';
import CloudAssetMenu from './CloudAssetMenu';
import TemporaryAssetNotice from './TemporaryAssetNotice';
import RatingControl from '@/components/RatingControl';
import { rateAccountAsset } from '@/lib/account/use-library';
import { groupByPrompt, type Rating } from '@/lib/results/rating';
import { resultModelLabel, reuseRun } from '@/lib/results/reuse-run';

export default function CloudAssetGrid({assets,ownerId,mode='browse',referenceLimit=8,columns=2,highlightAssetId,onUsedReference,onAddedToTimeline,onPickVideo,editCapability,onChanged,onRated,onOpenStudio,grouped=false,emptyMessage}: {
  assets:CloudAsset[];ownerId:string;mode?:'browse'|'pick-image'|'pick-clip';referenceLimit?:number;
  /** Widest column count at desktop. The overlay stays at two because it sits
   *  in a narrow sheet; the account console goes to four. */
  columns?:2|4;
  /** One card to single out, arrived at through `/account#asset-<id>` — the job
   *  queue's answer to "which of these is the row I clicked". Passing it is also
   *  what turns on the anchor ids: two grids can be mounted at once (the console
   *  behind the studio header's library overlay), and duplicate ids would send
   *  the deep link to whichever rendered first. */
  highlightAssetId?:string|null;
  onUsedReference?:()=>void;
  /** Fired after a cloud clip lands on the timeline, so the host can close the
   *  picker and — from the browse library — switch to the timeline workspace. */
  onAddedToTimeline?:()=>void;
  onPickVideo?:(file:File)=>Promise<void>;
  /** The edit model currently chosen. Absent on the timeline, which keeps the 100 MB application cap. */
  editCapability?:Pick<VideoEditCapability,'mimes'|'maxBytes'>;
  onChanged:()=>void;
  /** The asset as the Worker saved it after a rating, so the card updates before the next poll. */
  onRated?:(asset:CloudAsset)=>void;
  /** Opens the studio where "Reuse settings" selected the asset's model. */
  onOpenStudio?:(href:string)=>void;
  /** Lines up the runs of one prompt under a heading. Groups only what this page holds. */
  grouped?:boolean;
  /** Replaces the empty-library line when a filter, not an empty account, left nothing. */
  emptyMessage?:string;
}) {
  const [busy,setBusy]=useState<string|null>(null);
  // Which control started the running action, so the spinner lands on it: an
  // extraction started from the ⋯ menu read as "Add to timeline" working.
  const [busyInMenu,setBusyInMenu]=useState(false);
  const [removing,setRemoving]=useState<CloudAsset|null>(null);
  // Held by id, not by object, so a library refresh or a deletion resolves the
  // open preview away instead of leaving a stale copy on screen.
  const [previewId,setPreviewId]=useState<string|null>(null);
  const pending=useRef(false),mounted=useRef(true);
  const visible=mode==='pick-image'?assets.filter(asset=>asset.kind==='image'):mode==='pick-clip'?assets.filter(asset=>asset.kind==='video'):assets;
  const dense=columns===4;
  const preview=visible.find(asset=>asset.id===previewId&&asset.kind==='image')??null;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  /** Bring the singled-out card to the reader rather than leaving them to find
   *  the outline. Not left to the browser's own hash scrolling: the grid is
   *  client-rendered from a poll, so the element does not exist yet at the
   *  moment the hash lands. */
  useEffect(()=>{
    if(!highlightAssetId)return;
    const card=document.getElementById(`asset-${highlightAssetId}`);
    if(!card)return;
    const still=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({block:'center',behavior:still?'auto':'smooth'});
  },[highlightAssetId,assets]);
  function assertOwner(){
    if(useAccountStore.getState().session?.account?.id!==ownerId)throw new Error('Your account changed. Try again from the current library.');
  }
  /**
   * Failures are reported the way `GalleryGrid` reports them — a toast, not an
   * inline line at the top of the grid. The two grids sit behind the same two
   * tabs of the same picker, and an alert rendered above a scrolled list is
   * invisible at the moment it is written: a rejected "Use image" read as a
   * button that does nothing at all, which is exactly how it was reported.
   */
  async function run(asset:CloudAsset,action:()=>Promise<unknown>,fromMenu=false){
    if(pending.current)return;pending.current=true;setBusy(asset.id);setBusyInMenu(fromMenu);
    try{assertOwner();await action();}
    catch(error){toast.error(error instanceof Error&&error.message?error.message:'Please try again.');}
    finally{pending.current=false;if(mounted.current)setBusy(null);}
  }
  function reference(asset:CloudAsset){return run(asset,async()=>{await addAccountAssetAsReference(asset,ownerId,referenceLimit??8);assertOwner();toast.success('Added as a reference');onUsedReference?.();});}
  /**
   * Downloads the clip into the browser library, then places it. Adding through
   * the store rather than through a callback into the workspace is what lets
   * this work from the browse library too: `TimelineWorkspace` resolves any
   * placement that has no acquisition state, on mount as well as on change, so
   * a clip added while the timeline is closed is already resolved when it opens.
   */
  function addToTimeline(asset:CloudAsset){return run(asset,async()=>{const recordId=await saveCloudVideoToGallery(asset,ownerId);assertOwner();await placeClipOnTimeline(recordId);onAddedToTimeline?.();});}
  function reuseSettings(asset:CloudAsset){
    if(useAccountStore.getState().session?.account?.id!==ownerId)return;
    const href=reuseRun({provider:asset.metadata.provider,modelId:asset.metadata.modelId,mediaType:asset.kind,inputMode:asset.metadata.inputMode,prompt:asset.metadata.prompt,values:asset.metadata.values});
    toast.success(href?'Model, prompt and settings loaded':'Prompt and settings loaded');
    if(href&&onOpenStudio)onOpenStudio(href);else onUsedReference?.();
  }
  /** Not routed through `run`: a rating is a small write that should not lock
   *  every other card's buttons while it lands. */
  const [rating,setRating]=useState<string|null>(null);
  async function rate(asset:CloudAsset,value:Rating|null){
    setRating(asset.id);
    try{assertOwner();const saved=await rateAccountAsset(asset.id,value,ownerId);assertOwner();onRated?.(saved);}
    catch(error){toast.error(error instanceof Error&&error.message?error.message:'Could not save this rating.');}
    finally{if(mounted.current)setRating(null);}
  }
  async function remove(asset:CloudAsset){
    await run(asset,async()=>{await accountRequest(`assets/${asset.id}`,{method:'DELETE',headers:{'X-Account-Id':ownerId}});assertOwner();if(mounted.current)setRemoving(null);onChanged();});
  }
  const card=(asset:CloudAsset)=>{const singled=highlightAssetId===asset.id;const modelLabel=resultModelLabel({provider:asset.metadata.provider,modelId:asset.metadata.modelId,mediaType:asset.kind});return <li key={asset.id} {...(highlightAssetId!==undefined?{id:`asset-${asset.id}`}:{})} {...(singled?{'aria-current':'true' as const}:{})} className={`scroll-mt-24 rounded-xl border bg-[var(--background-elevated)]/80 transition-colors motion-reduce:transition-none ${singled?'border-[var(--neon-cyan)] ring-2 ring-[var(--neon-cyan)]/70 ring-offset-2 ring-offset-[var(--background-elevated)]':'border-cyan-300/25 hover:border-cyan-300/50'} ${dense?'space-y-2.5 p-2.5':'space-y-3 p-3'}`}>
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black/40">
          {asset.kind==='image'?
            // Private same-origin authorization redirects to an expiring Worker capability.
            mode==='browse'?
              <button type="button" onClick={()=>setPreviewId(asset.id)} aria-label={`Preview ${asset.metadata.prompt||'saved cloud image'}`} className="h-full w-full cursor-zoom-in transition-opacity hover:opacity-90 motion-reduce:transition-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" src={`/api/account/assets/${asset.id}/content`} alt="" className="h-full w-full object-contain"/>
              </button>:
              // eslint-disable-next-line @next/next/no-img-element
              <img loading="lazy" src={`/api/account/assets/${asset.id}/content`} alt={asset.metadata.prompt||'Saved cloud image'} className="h-full w-full object-contain"/>:
            <VideoPlayer crossOrigin reveal="always" src={`/api/account/assets/${asset.id}/content`} label={asset.metadata.prompt||'Saved cloud video'} className="h-full w-full"/>}
        </div>
        <div><p className={`line-clamp-2 font-medium text-[var(--foreground)] ${dense?'text-[0.8125rem] leading-snug':'text-sm'}`}>{asset.metadata.prompt||'Untitled result'}</p><p className={`mt-1 text-cyan-200 ${dense?'text-[0.625rem]':'text-xs'}`}>{asset.origin?<a href={watchUrl(asset.origin)} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">From YouTube · {formatClock(asset.origin.startSeconds)}–{formatClock(asset.origin.endSeconds)}</a>:<>{modelLabel&&<span className="font-medium">{modelLabel} · </span>}{asset.metadata.provider}</>} · {asset.kind} · {formatAccountBytes(asset.bytes)}{asset.metadata.values.moderation === 'relaxed' ? ' · Relaxed' : ''}{asset.expiresAt?' · Temporary':''}{asset.startedBy?` · via ${asset.startedBy.name??'an agent'}`:''}</p></div>
        {mode==='browse'&&<RatingControl value={asset.rating} disabled={rating===asset.id} onChange={value=>void rate(asset,value)}/>}
        <div className={`flex ${dense?'gap-1.5':'gap-2'}`}>
          {/* One action on the face of the card; the rest wait in the ⋯ menu.
              Shortened on the face in the dense grid, spelled out for assistive
              tech: the full phrase stays the accessible name, and it still
              contains the visible words so voice control matches what is on screen. */}
          {asset.kind==='image'&&mode!=='pick-clip'&&<button type="button" disabled={busy!==null} onClick={()=>void reference(asset)} aria-label={mode==='pick-image'||!dense?undefined:'Use as reference'} className={`btn-secondary${mode==='browse'?' min-w-0 flex-1':''}`}>{busy===asset.id&&!busyInMenu?<Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>:<ImageDown size={13} aria-hidden="true"/>}{mode==='pick-image'?'Use image':dense?'Use as ref':'Use as reference'}</button>}
          {/* The action this grid existed without: a finished cloud clip had no
              route into the editor at all, so the only way to cut one was to
              download it and re-upload it through "Add files from your device". */}
          {asset.kind==='video'&&mode!=='pick-image'&&<button type="button" disabled={busy!==null} onClick={()=>void (onPickVideo ? run(asset,async()=>{const file=await videoFileFromAccount(asset,ownerId,editCapability);assertOwner();await onPickVideo(file);}) : addToTimeline(asset))} aria-label={dense?'Add to timeline':undefined} className={`btn-secondary${mode==='browse'?' min-w-0 flex-1':''}`}>{busy===asset.id&&!busyInMenu?<Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>:<Film size={13} aria-hidden="true"/>}{onPickVideo?'Use video':dense?'Timeline':'Add to timeline'}</button>}
          {mode==='browse'&&<CloudAssetMenu
            asset={asset}
            disabled={busy!==null}
            busy={busy===asset.id&&busyInMenu}
            run={task=>run(asset,task,true)}
            // A saved YouTube section has no generation settings to reuse.
            onReuseSettings={asset.origin?undefined:()=>reuseSettings(asset)}
            onDownload={()=>downloadAccountAsset(asset)}
            onDelete={()=>setRemoving(asset)}
            onContinue={onUsedReference}
          />}
        </div>
        {/* A paid step, so it stays on the card rather than in the menu. */}
        {mode==='browse'&&asset.draftId && asset.kind==='video' && <FinalizeDraftButton inputMode={asset.metadata.inputMode} durationSeconds={seedanceDraftSeconds(asset.metadata.values)} busy={busy!==null} onApprove={async()=>{
          const seconds=seedanceDraftSeconds(asset.metadata.values);
          if(!asset.draftId||seconds===undefined)throw new Error('This draft has no saved length, so it cannot be priced.');
          await submitSeedanceFinalize({prompt:asset.metadata.prompt,inputMode:asset.metadata.inputMode,modelId:asset.metadata.modelId,draftId:asset.draftId,durationSeconds:seconds});
          toast.success('Finalize started. It saves to your account.');
        }}/>}
      </li>;};
  return <>
    <TemporaryAssetNotice assets={visible}/>
    {visible.length===0?<p className="py-6 text-center text-sm text-[var(--foreground-muted)]">{mode==='pick-image'?'No cloud images on this page.':mode==='pick-clip'?'No cloud clips on this page.':emptyMessage??'Your saved cloud assets will appear here.'}</p>:
      grouped&&mode==='browse'?<div className="space-y-6">{groupByPrompt(visible,asset=>asset.metadata.prompt).map(group=><section key={group.key} aria-label={`Prompt: ${group.prompt||'Untitled'}`}>
        <h3 className="mb-2 line-clamp-2 text-sm font-medium text-[var(--foreground)]" title={group.prompt}>{group.prompt||'Untitled result'}<span className="ml-2 text-xs font-normal text-[var(--foreground-subtle)]">{group.items.length} {group.items.length===1?'run':'runs'}</span></h3>
        <ul className={libraryGridClass(columns)}>{group.items.map(card)}</ul>
      </section>)}</div>:
      <ul className={libraryGridClass(columns)}>{visible.map(card)}</ul>}
    <ImageLightbox
      src={preview?`/api/account/assets/${preview.id}/content`:null}
      open={Boolean(preview)}
      alt={preview?.metadata.prompt||'Saved cloud image, full size'}
      onClose={()=>setPreviewId(null)}
      onDownload={preview?()=>void run(preview,()=>downloadAccountAsset(preview)):undefined}
    />
    <ConfirmDialog open={Boolean(removing)} title="Delete this saved asset?" description="This removes the cloud copy from your account on every device. Download a copy first if you want to keep it." confirmLabel="Delete asset" onConfirm={()=>{if(removing)void remove(removing);}} onCancel={()=>setRemoving(null)}/>
  </>;
}
