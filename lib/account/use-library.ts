'use client';

import { useEffect, useRef, useState } from 'react';
import { accountRequest } from './client';
import { useAccountStore } from '@/store/useAccountStore';
import { isActiveJob } from './job-status';
import type { CloudAsset, CloudAssetCounts, CloudJobView, CloudProvider } from './contracts';
import type { Rating, RatingFilter } from '@/lib/results/rating';

/** Values that narrow the asset query itself. Job-state filters live in the
 *  page, because a job that never produced an asset cannot be an asset query. */
export type LibraryKind = 'all' | 'image' | 'video' | 'temporary';

export interface AccountStorage { limitBytes:number; usedBytes:number; reservedBytes:number; activeJobs:number }
export function formatAccountBytes(bytes:number) {
  if(bytes===0)return '0 MB';
  if(bytes<1_000)return `${bytes} B`;
  const unit=bytes<1_000_000?'KB':'MB';
  return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(bytes/(unit==='KB'?1_000:1_000_000))+' '+unit;
}

/** A model as the library filters on it: provider and id together, because two
 *  providers can host the same id. */
export interface ModelFilter { provider:CloudProvider; modelId:string }

/** Rating and model narrowing, applied by the Worker before it pages. */
export interface AssetFilters { rating?:RatingFilter; model?:ModelFilter|null }

/** Rates (or, with `null`, unrates) one saved asset. */
export async function rateAccountAsset(id:string,rating:Rating|null,ownerId:string) {
  return (await accountRequest<{asset:CloudAsset}>(`assets/${id}/rating`,{method:'POST',headers:{'Content-Type':'application/json','X-Account-Id':ownerId},body:JSON.stringify({rating})})).asset;
}

/** Mount under an owner key. Each page is authoritative; no remote data enters IndexedDB. */
export function useAccountLibrary(ownerId:string,kind:LibraryKind='all',filters:AssetFilters={}) {
  const rating=filters.rating??'all';
  const modelProvider=filters.model?.provider??null, modelId=filters.model?.modelId??null;
  const [jobs,setJobs]=useState<CloudJobView[]>([]);
  const [assets,setAssets]=useState<CloudAsset[]>([]);
  const [storage,setStorage]=useState<AccountStorage|null>(null);
  const [counts,setCounts]=useState<CloudAssetCounts|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const [cursor,setCursor]=useState<string|null>(null);
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  // Read by the poll timer without restarting it on every page of results.
  const latestJobs=useRef<CloudJobView[]>([]);
  useEffect(()=>{
    const controller=new AbortController();let running=false;
    const filters=[
      ...(kind==='image'||kind==='video'?[`kind=${kind}`]:[]),
      ...(kind==='temporary'?['temporary=1']:[]),
      ...(rating!=='all'?[`rating=${rating}`]:[]),
      ...(modelProvider&&modelId?[`provider=${encodeURIComponent(modelProvider)}`,`model=${encodeURIComponent(modelId)}`]:[]),
      ...(cursor?[`cursor=${encodeURIComponent(cursor)}`]:[]),
    ];
    const query=filters.length?`?${filters.join('&')}`:'';
    const read=<T,>(path:string)=>accountRequest<T>(path,{signal:controller.signal,headers:{'X-Account-Id':ownerId}});
    async function refresh(){
      if(running)return;running=true;
      try{
        const [jobPage,assetPage,quota]=await Promise.all([
          read<{jobs:CloudJobView[]}>('jobs'),
          read<{assets:CloudAsset[];nextCursor:string|null;counts?:CloudAssetCounts}>(`assets${query}`),
          read<{storage:AccountStorage}>('storage'),
        ]);
        // Counts are account-wide, so they survive a filter change: the pills
        // keep their numbers while the grid below them reloads.
        // Defaulted at the boundary: a truncated or unexpected payload should
        // leave the page empty, not hand `undefined` to the render.
        if(!controller.signal.aborted){latestJobs.current=jobPage?.jobs??[];setJobs(latestJobs.current);setAssets(assetPage?.assets??[]);setNextCursor(assetPage?.nextCursor??null);if(assetPage?.counts)setCounts(assetPage.counts);setStorage(quota?.storage??null);setError(null);
          // The queue card counts from the session store, which polls on its own
          // slow heartbeat. Without this, settling a job here left the count
          // saying two for up to half a minute - the same stale number the card
          // was collapsed to stop showing. applyJobs is owner and epoch guarded,
          // so a stale page cannot write into a newer account.
          const account=useAccountStore.getState();
          account.applyJobs(ownerId,account.epoch,latestJobs.current,account.assets);}
      }catch(error){if(!controller.signal.aborted)setError(error instanceof Error&&error.message?error.message:'Could not load your cloud library.');}
      finally{running=false;if(!controller.signal.aborted)setLoading(false);}
    }
    // Same rule as the session provider: every tick while a job is in flight,
    // a slow heartbeat otherwise, nothing for a hidden tab.
    let lastRead=0;
    const tick=()=>{
      if(document.visibilityState==='hidden')return;
      if(latestJobs.current.some(isActiveJob)||Date.now()-lastRead>=30000){lastRead=Date.now();void refresh();}
    };
    lastRead=Date.now();void refresh();const timer=setInterval(tick,5000);
    return()=>{controller.abort();clearInterval(timer);};
  },[revision,cursor,ownerId,kind,rating,modelProvider,modelId]);
  // A filter change starts from the newest page: a cursor from the old filter
  // points into a list this one may not contain.
  const filterKey=`${kind}|${rating}|${modelProvider}|${modelId}`;
  const [seenFilter,setSeenFilter]=useState(filterKey);
  if(seenFilter!==filterKey){setSeenFilter(filterKey);setCursor(null);setNextCursor(null);}
  /** Applies a rating the Worker just confirmed without waiting for the next poll,
   *  moving one count between pills so they agree with the card. A card that no
   *  longer matches the filter stays until the next poll rather than vanishing
   *  under the pointer mid-triage. */
  function replaceAsset(next:CloudAsset){
    const previous=assets.find(asset=>asset.id===next.id);
    setAssets(current=>current.map(asset=>asset.id===next.id?next:asset));
    if(!previous||previous.rating===next.rating)return;
    setCounts(current=>{
      if(!current?.ratings)return current;
      const ratings={...current.ratings};
      ratings[previous.rating??'unrated']=Math.max(0,ratings[previous.rating??'unrated']-1);
      ratings[next.rating??'unrated']+=1;
      return {...current,ratings};
    });
  }
  function page(value:string|null){
    if(value===cursor)return;
    setAssets([]);setNextCursor(null);setError(null);setLoading(true);setCursor(value);
  }
  function refresh(){setError(null);setLoading(true);setRevision(n=>n+1);}
  return {jobs,assets,storage,counts,error,loading,cursor,nextCursor,page,refresh,replaceAsset};
}
