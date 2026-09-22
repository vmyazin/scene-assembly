import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import JobQueueOverlay from '@/components/account/JobQueueOverlay';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';
import { useJobQueueStore } from '@/store/useJobQueueStore';
import { useAppStore } from '@/store/useAppStore';
import type { CloudAsset, CloudJobState, CloudJobView } from '@/lib/account/contracts';

const session: AccountSession = {account:{id:'owner',name:'Owner',email:'owner@example.test'},googleEnabled:true,localSignIn:false,providers:['runware'],connections:[]};
function job(id:string,state:CloudJobState,over:Partial<CloudJobView>={}):CloudJobView {
  return {id,provider:'runware',state,errorCode:null,createdAt:1,updatedAt:1,
    request:{provider:'runware',modelId:'bytedance:seedance@2.0-mini',mediaType:'video',inputMode:'text',prompt:'A canal at dusk',values:{},referenceIds:[]},...over};
}
function show(jobs:CloudJobView[],assets:CloudAsset[]=[]) {
  const state=useAccountStore.getState();
  state.applyJobs('owner',state.epoch,jobs,assets);
  render(<JobQueueOverlay/>);
}
function asset(id:string,jobId:string):CloudAsset {
  return {id,kind:'video',mimeType:'video/mp4',bytes:10,createdAt:1,jobId,
    metadata:{provider:'runware',modelId:'bytedance:seedance@2.0-mini',mediaType:'video',inputMode:'text',prompt:'A canal at dusk',values:{},referenceIds:[]}};
}
beforeEach(()=>{
  vi.clearAllMocks();
  useAccountStore.getState().applySession(session);
  useJobQueueStore.setState({dismissed:[]});
});

describe('job queue overlay',()=>{
  it('names the media and model of each job still in flight',()=>{
    show([job('a','running'),job('b','queued')]);
    expect(screen.getAllByText('Video, Seedance 2.0 Mini')).toHaveLength(2);
    expect(screen.getByText('Generating')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
  it('falls back to the raw id for a provider the catalogs do not carry',()=>{
    // `local-test` is a real CloudProvider that reaches the browser in local
    // development, and the shared catalog throws on any key it does not hold.
    show([job('a','running',{provider:'local-test',request:{provider:'local-test',modelId:'local-test',mediaType:'image',inputMode:'text',prompt:'x',values:{},referenceIds:[]}})]);
    expect(screen.getByText('Image, local-test')).toBeInTheDocument();
  });
  it('names each fixed-engine model rather than its API id',()=>{
    show([job('a','running',{provider:'gemini',request:{provider:'gemini',modelId:'gemini-3-pro-image-preview',mediaType:'image',inputMode:'text',prompt:'x',values:{},referenceIds:[]}})]);
    expect(screen.getByText('Image, Gemini 3 Pro Image')).toBeInTheDocument();
  });
  it('renders nothing when no job is in flight',()=>{
    // Succeeded work never keeps the card alive by itself: it is context for a
    // run in progress, not a receipt that follows the reader around after one.
    show([job('a','saved'),job('b','cancelled')]);
    expect(screen.queryByLabelText('Job queue')).toBeNull();
  });
  it('collapses to a count when nothing is in flight, and points at where it can be settled',()=>{
    // Unfinished business does not resolve itself and `dismissed` is per-tab, so
    // as a list this rebuilt on every reload and followed the reader all run.
    // The count is decisions only: the failed job below needs no decision, it
    // needs clearing, and counting the two together is how five real decisions
    // wore an "11 jobs need attention" badge.
    show([job('a','saved'),job('b','needs_attention',{errorCode:'storage_full'}),job('c','failed')]);
    const link=screen.getByRole('link',{name:'1 job needs attention'});
    expect(link).toHaveAttribute('href','/account#jobs');
    // A count, not the rows it replaced.
    expect(screen.queryByText('Needs attention')).toBeNull();
    expect(screen.queryByText('Video, Seedance 2.0 Mini')).toBeNull();
    expect(screen.queryByText('Saved')).toBeNull();
  });
  it('counts decisions in the plural',()=>{
    show([job('a','needs_attention',{errorCode:'storage_full'}),job('b','needs_attention',{errorCode:'save_failed'})]);
    expect(screen.getByRole('link',{name:'2 jobs need attention'})).toBeInTheDocument();
  });
  it('raises no standing alarm for stopped records alone',()=>{
    // A row that already failed is a record to clear on /account, not an alert
    // worth following someone across every page for the rest of the session.
    show([job('a','failed'),job('b','cancelled')]);
    expect(screen.queryByLabelText('Job queue')).toBeNull();
  });
  it('still names every job while something is in flight',()=>{
    // The card earns its size only while there is progress to report.
    show([job('a','running'),job('b','needs_attention',{errorCode:'storage_full'})]);
    expect(screen.getByText('Generating')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });
  it('hides a dismissed row without touching the account',async()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    // Dismissal is offered on the expanded card only, so something must be
    // running for the row to exist at all.
    show([job('a','failed'),job('b','running')]);
    fireEvent.click(screen.getByRole('button',{name:'Dismiss Video, Seedance 2.0 Mini'}));
    expect(screen.queryByText('Failed')).toBeNull();
    // Dismissal is a view state. Stopping tracking is a separate, confirmed action.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAccountStore.getState().jobs).toHaveLength(2);
    vi.unstubAllGlobals();
  });
  it('offers no dismiss on a job that is still running',()=>{
    show([job('a','running')]);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('names a tracking-stopped job by what happened to it',()=>{
    show([job('a','failed',{errorCode:'tracking_stopped'}),job('b','running')]);
    expect(screen.getByText('Tracking stopped')).toBeInTheDocument();
  });
  it('keeps a succeeded job in the list, with its state and how long it took',()=>{
    show([job('a','running'),job('b','saved',{createdAt:1000,updatedAt:13000})]);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    // The same JobElapsed treatment as every other row, stopped rather than counting.
    expect(screen.getByRole('timer',{name:'Took 0:12'})).toBeInTheDocument();
  });
  it('points a succeeded row at the one library card it produced',()=>{
    show([job('a','running'),job('b','saved')],[asset('other','a'),asset('mine','b')]);
    const link=screen.getByRole('link',{name:/Saved/});
    expect(link).toHaveAttribute('href','/account#asset-mine');
  });
  it('still offers the library when the asset is not loaded yet',()=>{
    show([job('a','running'),job('b','saved')]);
    expect(screen.getByRole('link',{name:/Saved/})).toHaveAttribute('href','/account');
  });
  it('points a running row back at the form it was started from, engine and all',()=>{
    show([job('a','running',{request:{provider:'runware',modelId:'bytedance:seedance@2.0-mini',mediaType:'video',inputMode:'image',prompt:'x',values:{},referenceIds:[]}})]);
    const link=screen.getByRole('link',{name:/Generating/});
    expect(link).toHaveAttribute('href','/?workspace=video&videoMode=image');
    // The panel holding the spinner filters on engine and model, which live in
    // the app store rather than the URL, so the click has to set them too.
    useAppStore.setState({videoEngine:'kie'});
    fireEvent.click(link);
    expect(useAppStore.getState().videoEngine).toBe('runware');
  });
  it('leaves a row with no workspace as plain text rather than a dead link',()=>{
    show([job('a','running',{provider:'local-test',request:{provider:'local-test',modelId:'local-test',mediaType:'image',inputMode:'text',prompt:'x',values:{},referenceIds:[]}})]);
    expect(screen.getByText('Image, local-test')).toBeInTheDocument();
    expect(screen.queryByRole('link',{name:/Generating/})).toBeNull();
  });
  it('counts succeeded rows against the cap, but never ahead of the running ones',()=>{
    // A run of four finished images must not push the one still generating off
    // the bottom of a five-row card.
    show([...['s1','s2','s3','s4','s5'].map(id=>job(id,'saved')),job('live','running')]);
    expect(screen.getByText('Generating')).toBeInTheDocument();
    expect(screen.getAllByText('Saved')).toHaveLength(4);
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });
  it('sends overflow to the account page rather than growing',()=>{
    show(['a','b','c','d','e','f','g'].map(id=>job(id,'running')));
    expect(screen.getAllByText('Video, Seedance 2.0 Mini')).toHaveLength(5);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });
});
