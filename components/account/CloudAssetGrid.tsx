'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Film, ImageDown, Loader2, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import ImageLightbox from '@/components/ImageLightbox';
import LastFrameActions from '@/components/LastFrameActions';
import { videoFileFromAccount } from '@/lib/account/video-source';
import { accountRequest } from '@/lib/account/client';
import type { CloudAsset } from '@/lib/account/contracts';
import { downloadAccountAsset } from '@/lib/account/download';
import { knownAccountAssetFilenameBase } from '@/lib/account/asset-name';
import { addAccountAssetAsReference } from '@/lib/account/reference';
import { formatAccountBytes } from '@/lib/account/use-library';
import { saveCloudVideoToGallery } from '@/lib/timeline/import-cloud';
import { useAccountStore } from '@/store/useAccountStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useTimelineStore } from '@/store/useTimelineStore';
import VideoPlayer from '@/components/video/VideoPlayer';
import TemporaryAssetNotice from './TemporaryAssetNotice';

export default function CloudAssetGrid({assets,ownerId,mode='browse',referenceLimit=8,columns=2,highlightAssetId,onUsedReference,onAddedToTimeline,onPickVideo,onChanged}: {
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
  onChanged:()=>void;
}) {
  const [busy,setBusy]=useState<string|null>(null);
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
  async function run(asset:CloudAsset,action:()=>Promise<unknown>){
    if(pending.current)return;pending.current=true;setBusy(asset.id);
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
  function addToTimeline(asset:CloudAsset){return run(asset,async()=>{const recordId=await saveCloudVideoToGallery(asset,ownerId);assertOwner();useTimelineStore.getState().addClip(recordId);toast.success('Added to the timeline');onAddedToTimeline?.();});}
  function restore(asset:CloudAsset){
    if(useAccountStore.getState().session?.account?.id!==ownerId)return;
    const draft=useDraftStore.getState();draft.setPrompt(asset.metadata.prompt);draft.rememberControlValues(asset.metadata.values);
    toast.success('Prompt and settings restored');onUsedReference?.();
  }
  async function remove(asset:CloudAsset){
    await run(asset,async()=>{await accountRequest(`assets/${asset.id}`,{method:'DELETE',headers:{'X-Account-Id':ownerId}});assertOwner();if(mounted.current)setRemoving(null);onChanged();});
  }
  return <>
    <TemporaryAssetNotice assets={visible}/>
    {visible.length===0?<p className="py-6 text-center text-sm text-[var(--foreground-muted)]">{mode==='pick-image'?'No cloud images on this page.':mode==='pick-clip'?'No cloud clips on this page.':'Your saved cloud assets will appear here.'}</p>:
      <ul className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${columns===4?'lg:grid-cols-3 xl:grid-cols-4':''}`}>{visible.map(asset=>{const singled=highlightAssetId===asset.id;return <li key={asset.id} {...(highlightAssetId!==undefined?{id:`asset-${asset.id}`}:{})} {...(singled?{'aria-current':'true' as const}:{})} className={`scroll-mt-24 rounded-xl border bg-[var(--background-elevated)]/80 transition-colors motion-reduce:transition-none ${singled?'border-[var(--neon-cyan)] ring-2 ring-[var(--neon-cyan)]/70 ring-offset-2 ring-offset-[var(--background-elevated)]':'border-cyan-300/25 hover:border-cyan-300/50'} ${dense?'space-y-2.5 p-2.5':'space-y-3 p-3'}`}>
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
        <div><p className={`line-clamp-2 font-medium text-[var(--foreground)] ${dense?'text-[0.8125rem] leading-snug':'text-sm'}`}>{asset.metadata.prompt||'Untitled result'}</p><p className={`mt-1 text-cyan-200 ${dense?'text-[0.625rem]':'text-xs'}`}>{asset.metadata.provider} · {asset.kind} · {formatAccountBytes(asset.bytes)}{asset.expiresAt?' · Temporary':''}</p></div>
        <div className={`flex flex-wrap ${dense?'gap-1.5':'gap-2'}`}>
          {/* Shortened on the face, spelled out for assistive tech: the full
              phrase stays the accessible name, and it still contains the
              visible words so voice control matches what is on screen. */}
          {asset.kind==='image'&&mode!=='pick-clip'&&<button type="button" disabled={busy!==null} onClick={()=>void reference(asset)} aria-label={mode==='pick-image'?undefined:'Use as reference'} className="btn-secondary gap-1.5 px-2 py-1 text-xs">{busy===asset.id?<Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>:<ImageDown size={13} aria-hidden="true"/>}{mode==='pick-image'?'Use image':'Use as ref'}</button>}
          {/* The action this grid existed without: a finished cloud clip had no
              route into the editor at all, so the only way to cut one was to
              download it and re-upload it through "Add files from your device". */}
          {asset.kind==='video'&&mode!=='pick-image'&&<button type="button" disabled={busy!==null} onClick={()=>void (onPickVideo ? run(asset,async()=>{const file=await videoFileFromAccount(asset,ownerId);assertOwner();await onPickVideo(file);}) : addToTimeline(asset))} aria-label={dense?'Add to timeline':undefined} className="btn-secondary gap-1.5 px-2 py-1 text-xs">{busy===asset.id?<Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>:<Film size={13} aria-hidden="true"/>}{onPickVideo?'Use video':dense?'Timeline':'Add to timeline'}</button>}
          {mode==='browse'&&<>
            <button type="button" onClick={()=>restore(asset)} aria-label={dense?`Restore settings from ${asset.metadata.prompt||'cloud asset'}`:undefined} title={dense?'Restore settings':undefined} className={`btn-secondary py-1 text-xs ${dense?'gap-0 px-1.5':'gap-1.5 px-2'}`}><Wand2 size={13} aria-hidden="true"/>{!dense&&'Restore settings'}</button>
            <button type="button" disabled={busy!==null} onClick={()=>void run(asset,()=>downloadAccountAsset(asset))} aria-label={`Download ${asset.metadata.prompt||'cloud asset'}`} title="Download" className={`btn-secondary py-1 text-xs ${dense?'px-1.5':'px-2'}`}><Download size={13} aria-hidden="true"/></button>
            <button type="button" disabled={busy!==null} onClick={()=>setRemoving(asset)} aria-label={`Delete ${asset.metadata.prompt||'cloud asset'}`} title="Delete" className={`btn-secondary py-1 text-xs hover:text-red-300 ${dense?'px-1.5':'px-2'}`}><Trash2 size={13} aria-hidden="true"/></button>
          </>}
        </div>
        {mode==='browse'&&asset.kind==='video'&&<LastFrameActions videoUrl={`/api/account/assets/${asset.id}/content`} filenameBase={knownAccountAssetFilenameBase(asset)} onContinue={onUsedReference}/>}
      </li>;})}</ul>}
    <ImageLightbox
      src={preview?`/api/account/assets/${preview.id}/content`:null}
      open={Boolean(preview)}
      alt={preview?.metadata.prompt||'Saved cloud image, full size'}
      onClose={()=>setPreviewId(null)}
      onDownload={preview?()=>void run(preview,()=>downloadAccountAsset(preview)):undefined}
    />
    {removing&&createPortal(<ConfirmDialog open title="Delete this saved asset?" description="This removes the cloud copy from your account on every device. Download a copy first if you want to keep it." confirmLabel="Delete asset" onConfirm={()=>void remove(removing)} onCancel={()=>setRemoving(null)}/>,document.body)}
  </>;
}
