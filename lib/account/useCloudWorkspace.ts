'use client';
// lib/account/useCloudWorkspace.ts
import { useRef } from 'react';
import { useAccountStore } from '@/store/useAccountStore';
import { runLocationKey, useRunLocationStore } from '@/store/useRunLocationStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import { warmAccountSlug } from './asset-name';
import { refreshAccount } from './session';
import { fileWithReferenceClipType } from '@/lib/providers/reference-clips';
import { submitAccountJob, uploadAccountReferences } from './client';
import type { CloudJobRequest, CloudJobView, CloudProvider } from './contracts';

interface ClipFiles { videos?: File[]; audios?: File[] }
interface Pending { owner:string;signature:string;files:File[];clipVideos:File[];clipAudios:File[];sourceVideo?:File;token:string;request:CloudJobRequest }
function sameFiles(left: File[], right: File[]) {
  return left.length === right.length && left.every((file, index) => file === right[index]);
}
export function useCloudWorkspace(provider:CloudProvider) {
  const session=useAccountStore(state=>state.session);
  const status=useAccountStore(state=>state.status);
  const pending=useRef<Pending|null>(null);
  const flight=useRef<Promise<CloudJobView>|null>(null);
  const hasJobs=useAccountStore(state=>state.jobs.some(job=>job.provider===provider));
  const owner=session?.account?.id;
  const signedIn=Boolean(owner);
  const uncertain=status==='unavailable'&&!session;
  // Survives the remount that switching engine or input mode causes. The old
  // pair of useState flags reduces exactly to this: background is the default
  // wherever it is possible at all, until this owner asks for the browser.
  const choice=useRunLocationStore(state=>state.choices[runLocationKey(owner,provider)]);
  const choose=useRunLocationStore(state=>state.choose);
  const choseBrowser=choice==='browser';
  const cloud=(signedIn||uncertain)&&!choseBrowser;
  const enabled=Boolean(session?.providers?.includes(provider));
  const connected=Boolean(session?.connections?.some(c=>c.provider===provider));
  // libraryPrompt is what the prompt library remembers once the job is accepted.
  // It defaults to the request prompt, but the image workspace wraps feature
  // instructions around what was typed and only the typed text belongs in history.
  async function perform(request:Omit<CloudJobRequest,'provider'|'referenceIds'|'sourceVideoId'|'referenceVideoIds'|'referenceAudioIds'>,files:File[],libraryPrompt:string,sourceVideo?:File,clips?:ClipFiles) {
    if(!owner||!cloud)throw new Error('Your account changed. Review the generation before starting it.');
    const epoch=useAccountStore.getState().epoch;
    const assertOwner=()=>{const state=useAccountStore.getState();if(state.epoch!==epoch||state.session?.account?.id!==owner)throw new Error('Your account changed. Review the generation before starting it.');};
    const current=await refreshAccount();
    assertOwner();
    if(current.account?.id!==owner)throw new Error('Your account changed. Review the generation before starting it.');
    if(!current.providers.includes(provider))throw new Error('Background generation is not available for this provider yet. You can explicitly choose browser-only generation below.');
    if(!current.connections.some(c=>c.provider===provider))throw new Error('Save this provider connection in your account before starting a background job.');
    const signature=JSON.stringify(request);
    const clipVideos=clips?.videos??[];
    const clipAudios=clips?.audios??[];
    let attempt=pending.current;
    if(!attempt||attempt.owner!==owner||attempt.signature!==signature||attempt.sourceVideo!==sourceVideo||!sameFiles(attempt.files,files)||!sameFiles(attempt.clipVideos,clipVideos)||!sameFiles(attempt.clipAudios,clipAudios)){
      // Images, then reference videos, then reference audio, then the edit source.
      // acceptJob reads that order back out of jobInputIds.
      const typedVideos=clipVideos.map((file)=>fileWithReferenceClipType(file,'video'));
      const typedAudios=clipAudios.map((file)=>fileWithReferenceClipType(file,'audio'));
      const ids=await uploadAccountReferences([...files,...typedVideos,...typedAudios,...(sourceVideo?[sourceVideo]:[])],undefined,owner);
      assertOwner();
      const sourceVideoId=sourceVideo?ids.pop():undefined;
      const referenceAudioIds=clipAudios.length?ids.splice(ids.length-clipAudios.length,clipAudios.length):undefined;
      const referenceVideoIds=clipVideos.length?ids.splice(ids.length-clipVideos.length,clipVideos.length):undefined;
      attempt={owner,signature,files:[...files],clipVideos:[...clipVideos],clipAudios:[...clipAudios],sourceVideo,token:crypto.randomUUID(),request:{...request,provider,referenceIds:ids,...(referenceVideoIds?.length?{referenceVideoIds}:{}),...(referenceAudioIds?.length?{referenceAudioIds}:{}),...(sourceVideoId?{sourceVideoId}:{})}};
      pending.current=attempt;
    }
    assertOwner();
    const {job}=await submitAccountJob(attempt.token,attempt.request,undefined,owner);
    assertOwner();
    // Same moment as every guest path: the provider has accepted the job. Before
    // this lived here, each workspace's cloud branch returned before its own
    // remember() call and signed-in prompts vanished from the library.
    usePromptLibraryStore.getState().remember(libraryPrompt);
    // Same moment the guest workspaces pin a filename slug to their job.
    warmAccountSlug(job.id,libraryPrompt);
    const state=useAccountStore.getState();
    if(state.session?.account?.id===owner)state.applyJobs(owner,state.epoch,[job,...state.jobs.filter(j=>j.id!==job.id)],state.assets);
    pending.current=null;
    return job;
  }
  function submit(request:Omit<CloudJobRequest,'provider'|'referenceIds'|'sourceVideoId'|'referenceVideoIds'|'referenceAudioIds'>,files:File[],libraryPrompt:string=request.prompt,sourceVideo?:File,clips?:ClipFiles){
    if(flight.current)return flight.current;
    const promise=perform(request,files,libraryPrompt,sourceVideo,clips).finally(()=>{flight.current=null;});
    flight.current=promise;return promise;
  }
  return {signedIn,cloud,enabled,connected,hasJobs,uncertain,fakeGeneration:Boolean(session?.fakeGeneration),checking:status==='loading'||uncertain&&!choseBrowser,unavailable:status==='unavailable',
    useBrowser:()=>choose(owner,provider,'browser'),useCloud:()=>choose(owner,provider,'cloud'),submit};
}
