'use client';
import { useRef } from 'react';
import { useAccountStore } from '@/store/useAccountStore';
import { runLocationKey, useRunLocationStore } from '@/store/useRunLocationStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import { warmAccountSlug } from './asset-name';
import { refreshAccount } from './session';
import { submitAccountJob, uploadAccountReferences } from './client';
import { forgetStagedSource, stagedSourceId } from './staged-sources';
import type { CloudJobRequest, CloudJobView, CloudProvider } from './contracts';

interface Pending { owner:string;signature:string;files:File[];sourceVideo?:File;token:string;request:CloudJobRequest }
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
  async function perform(request:Omit<CloudJobRequest,'provider'|'referenceIds'|'sourceVideoId'>,files:File[],libraryPrompt:string,sourceVideo?:File) {
    if(!owner||!cloud)throw new Error('Your account changed. Review the generation before starting it.');
    const epoch=useAccountStore.getState().epoch;
    const assertOwner=()=>{const state=useAccountStore.getState();if(state.epoch!==epoch||state.session?.account?.id!==owner)throw new Error('Your account changed. Review the generation before starting it.');};
    const current=await refreshAccount();
    assertOwner();
    if(current.account?.id!==owner)throw new Error('Your account changed. Review the generation before starting it.');
    if(!current.providers.includes(provider))throw new Error('Background generation is not available for this provider yet. You can explicitly choose browser-only generation below.');
    if(!current.connections.some(c=>c.provider===provider))throw new Error('Save this provider connection in your account before starting a background job.');
    const signature=JSON.stringify(request);
    let attempt=pending.current;
    if(!attempt||attempt.owner!==owner||attempt.signature!==signature||attempt.sourceVideo!==sourceVideo||attempt.files.length!==files.length||files.some((file,i)=>file!==attempt!.files[i])){
      // A YouTube import is already on the Worker; upload only what is not.
      const stagedId=sourceVideo?stagedSourceId(sourceVideo,owner):undefined;
      const ids=await uploadAccountReferences([...files,...(sourceVideo&&!stagedId?[sourceVideo]:[])],undefined,owner);
      assertOwner();
      const sourceVideoId=stagedId??(sourceVideo?ids.pop():undefined);
      attempt={owner,signature,files:[...files],sourceVideo,token:crypto.randomUUID(),request:{...request,provider,referenceIds:ids,...(sourceVideoId?{sourceVideoId}:{})}};
      pending.current=attempt;
    }
    assertOwner();
    const {job}=await submitAccountJob(attempt.token,attempt.request,undefined,owner);
    // One-use: once a job holds the staged input, cleanup may delete it when that job ends.
    if(sourceVideo)forgetStagedSource(sourceVideo);
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
  function submit(request:Omit<CloudJobRequest,'provider'|'referenceIds'|'sourceVideoId'>,files:File[],libraryPrompt:string=request.prompt,sourceVideo?:File){
    if(flight.current)return flight.current;
    const promise=perform(request,files,libraryPrompt,sourceVideo).finally(()=>{flight.current=null;});
    flight.current=promise;return promise;
  }
  return {signedIn,cloud,enabled,connected,hasJobs,uncertain,fakeGeneration:Boolean(session?.fakeGeneration),checking:status==='loading'||uncertain&&!choseBrowser,unavailable:status==='unavailable',
    useBrowser:()=>choose(owner,provider,'browser'),useCloud:()=>choose(owner,provider,'cloud'),submit};
}
