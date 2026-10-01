import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';
import { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
import { useAppStore } from '@/store/useAppStore';
import { useKieJobsStore } from '@/store/useKieJobsStore';
import { useDraftStore } from '@/store/useDraftStore';
import KieGenerationWorkspace from '@/components/KieGenerationWorkspace';
import type { CloudJobView } from '@/lib/account/contracts';
import GenerationInterface from '@/components/GenerationInterface';
import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FEATURES } from '@/types';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
const {refresh,upload,submit,guestSubmit}=vi.hoisted(()=>({refresh:vi.fn(),upload:vi.fn(),submit:vi.fn(),guestSubmit:vi.fn()}));
vi.mock('@/lib/account/session',()=>({refreshAccount:refresh}));
vi.mock('@/lib/account/client',()=>({uploadAccountReferences:upload,submitAccountJob:submit,accountRequest:vi.fn(),accountAssetUrl:vi.fn()}));
vi.mock('@/lib/kie/browser',()=>({submitKieJob:guestSubmit,uploadKieFiles:vi.fn().mockResolvedValue([]),fetchKieCredits:vi.fn().mockResolvedValue(null)}));
const session:AccountSession={account:{id:'owner',name:'Owner',email:'owner@example.test'},googleEnabled:true,localSignIn:false,providers:['kie'],connections:[{id:'connection',provider:'kie',hint:'test',revision:1}]};
const request={modelId:'nano-banana-pro',mediaType:'image' as const,inputMode:'text' as const,prompt:'Product photo',values:{}};
const job:CloudJobView={id:'account-job',provider:'kie',state:'queued',errorCode:null,request:{...request,provider:'kie',referenceIds:[]},createdAt:1,updatedAt:1};
beforeEach(()=>{
  vi.clearAllMocks();useAccountStore.getState().applySession(session);refresh.mockResolvedValue(session);upload.mockResolvedValue([]);submit.mockResolvedValue({job});
  useKieJobsStore.getState().clearJobs();useDraftStore.getState().reset();useAppStore.setState({kieApiKey:'',kieImageModel:'nano-banana-pro'});
  usePromptLibraryStore.setState({history:[],favourites:[]});
});
describe('account execution and isolation',()=>{
  it('uses the common image workspace account connection without a browser key',async()=>{
    const geminiSession:AccountSession={...session,providers:['gemini'],connections:[{id:'gemini-connection',provider:'gemini',revision:1,hint:'test'}]};
    useAccountStore.getState().applySession(geminiSession);refresh.mockResolvedValue(geminiSession);
    useAppStore.setState({engine:'gemini',apiKey:''});
    render(<QueryClientProvider client={new QueryClient()}><GenerationInterface feature={FEATURES.find(f=>f.id==='text-to-image')!} apiKey="" onBack={()=>{}} onOpenConnections={()=>{}}/></QueryClientProvider>);
    fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'Account image request'}});
    fireEvent.click(screen.getByRole('button',{name:/Generate Image/i}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1]).toMatchObject({provider:'gemini',modelId:'gemini-3-pro-image-preview',prompt:'Account image request',mediaType:'image'});
    expect(submit.mock.calls[0][1]).not.toHaveProperty('apiKey');
  });
  it('says what the press will cost, at the settings on screen',async()=>{
    // The rate and the duration were both already here; the reader was doing
    // the multiplication, once per clip, and had to keep the tier straight.
    useAppStore.setState({runwareApiKey:'runware-key',runwareVideoModel:'bytedance:seedance@2.0-mini'});
    useAccountStore.setState({status:'ready'});
    useProviderJobsStore.getState().clearJobs();

    render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="text" onBack={()=>{}} onOpenConnections={()=>{}}/>);

    const generate=screen.getByRole('button',{name:/^Generate video/});
    // 480p is $0.036/s and the model opens on its shortest duration.
    expect(generate).toHaveAccessibleName(/~\$\d+\.\d{2}/);
  });
  it('never lets Generate go dead without saying why',async()=>{
    // SA-02 asked for the error re-shown, or the button disabled with the
    // reason attached. While the session is still resolving this button is
    // disabled, so the reason has to travel on the button itself.
    const runwareSession:AccountSession={...session,providers:['runware'],connections:[{id:'runware-connection',provider:'runware',revision:1,hint:'test'}]};
    useAccountStore.getState().applySession(runwareSession);
    useAccountStore.setState({status:'loading'});

    render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="text" onBack={()=>{}} onOpenConnections={()=>{}}/>);

    const generate=screen.getByRole('button',{name:/Generate/i});
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('title','Still checking your account.');
  });
  it('stays usable after a background image-to-video submission fails',async()=>{
    // The exact SA-01 repro: Video -> Image to video -> attach a reference ->
    // Generate. The upload is what fails there, before any job exists.
    const runwareSession:AccountSession={...session,providers:['runware'],connections:[{id:'runware-connection',provider:'runware',revision:1,hint:'test'}]};
    useAccountStore.getState().applySession(runwareSession);refresh.mockResolvedValue(runwareSession);
    useAppStore.setState({runwareApiKey:'',runwareVideoModel:'lightricks:ltx@2.5-fast'});
    useProviderJobsStore.getState().clearJobs();
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:reference')});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
    useDraftStore.getState().addReferences([{file:new File(['x'],'frame.png',{type:'image/png'})}],1);
    upload.mockRejectedValue(new Error('Too many references are still in use for background jobs.'));

    render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="image" onBack={()=>{}} onOpenConnections={()=>{}}/>);
    fireEvent.change(screen.getByLabelText('Prompt'),{target:{value:'A canal at dusk'}});

    fireEvent.click(screen.getByRole('button',{name:/Generate/i}));
    await waitFor(()=>expect(upload).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/still in use/)).toBeInTheDocument();

    // The second press has to reach the account again, not be swallowed.
    fireEvent.click(screen.getByRole('button',{name:/Generate/i}));
    await waitFor(()=>expect(upload).toHaveBeenCalledTimes(2));
  });
  it('stays usable after a background submission fails',async()=>{
    // SA-02: once the storage error fired, further clicks did nothing at all -
    // no job, no error, no network call - and the button still looked live.
    const geminiSession:AccountSession={...session,providers:['gemini'],connections:[{id:'gemini-connection',provider:'gemini',revision:1,hint:'test'}]};
    useAccountStore.getState().applySession(geminiSession);refresh.mockResolvedValue(geminiSession);
    useAppStore.setState({engine:'gemini',apiKey:''});
    submit.mockRejectedValue(new Error('Too many references are still in use for background jobs.'));
    render(<QueryClientProvider client={new QueryClient()}><GenerationInterface feature={FEATURES.find(f=>f.id==='text-to-image')!} apiKey="" onBack={()=>{}} onOpenConnections={()=>{}}/></QueryClientProvider>);
    fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'A canal at dusk'}});

    fireEvent.click(screen.getByRole('button',{name:/Generate Image/i}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/still in use/)).toBeInTheDocument();

    // The second press has to reach the account again, not be swallowed.
    fireEvent.click(screen.getByRole('button',{name:/Generate Image/i}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(2));
  });
  it('asks for the account connection, not the browser key, when fal runs in the cloud',async()=>{
    const falSession:AccountSession={...session,providers:['fal'],connections:[{id:'fal-connection',provider:'fal',revision:1,hint:'test'}]};
    useAccountStore.getState().applySession(falSession);refresh.mockResolvedValue(falSession);
    useAppStore.setState({engine:'fal',falApiKey:''});
    const {rerender}=render(<QueryClientProvider client={new QueryClient()}><GenerationInterface feature={FEATURES.find(f=>f.id==='text-to-image')!} apiKey="" onBack={()=>{}} onOpenConnections={()=>{}}/></QueryClientProvider>);
    expect(screen.queryByText('Connect your fal API key to use this engine.')).toBeNull();
    fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'Account fal request'}});
    fireEvent.click(screen.getByRole('button',{name:/Generate Image/i}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1]).toMatchObject({provider:'fal',mediaType:'image',prompt:'Account fal request'});
    // Without a saved connection the cloud path must still ask, and it asks for the account one.
    const noConnection={...falSession,connections:[]};
    useAccountStore.getState().applySession(noConnection);refresh.mockResolvedValue(noConnection);
    rerender(<QueryClientProvider client={new QueryClient()}><GenerationInterface feature={FEATURES.find(f=>f.id==='text-to-image')!} apiKey="" onBack={()=>{}} onOpenConnections={()=>{}}/></QueryClientProvider>);
    expect(screen.getByText('Connect your fal API key to use this engine.')).toBeTruthy();
  });
  it('submits aggregator cloud video without adding a guest video job',async()=>{
    const runwareSession:AccountSession={...session,providers:['runware'],connections:[{id:'runware-connection',provider:'runware',revision:1,hint:'test'}]};
    useAccountStore.getState().applySession(runwareSession);refresh.mockResolvedValue(runwareSession);
    useAppStore.setState({runwareApiKey:'',runwareVideoModel:'lightricks:ltx@2.5-fast'});useProviderJobsStore.getState().clearJobs();
    render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="text" onBack={()=>{}} onOpenConnections={()=>{}}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'Account video request'}});
    // The button now carries its own estimate, so the name is a prefix match.
    fireEvent.click(screen.getByRole('button',{name:/^Generate video/}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1]).toMatchObject({provider:'runware',mediaType:'video',values:{durationSeconds:6,size:'720p · 16:9'}});
    expect(useProviderJobsStore.getState().jobs).toHaveLength(0);
  });
  it('submits Atlas MiniMax H3 cloud video without an audio switch the Worker refuses',async()=>{
    const atlasSession:AccountSession={...session,providers:['atlas'],connections:[{id:'atlas-connection',provider:'atlas',revision:1,hint:'test'}]};
    useAccountStore.getState().applySession(atlasSession);refresh.mockResolvedValue(atlasSession);
    useAppStore.setState({atlasApiKey:'',atlasVideoModel:'minimax/h3-developer/text-to-video'});useProviderJobsStore.getState().clearJobs();
    render(<ProviderVideoWorkspace provider="atlas" label="Atlas Cloud" inputMode="text" onBack={()=>{}} onOpenConnections={()=>{}}/>);
    // H3 always generates its soundtrack; Atlas publishes no switch to turn it off.
    expect(screen.queryByRole('checkbox',{name:'Generate audio'})).toBeNull();
    fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'Account H3 request'}});
    fireEvent.click(screen.getByRole('button',{name:/^Generate video/}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1]).toMatchObject({provider:'atlas',modelId:'minimax/h3-developer/text-to-video',mediaType:'video',values:{durationSeconds:8,size:'480p',aspectRatio:'16:9'}});
    expect(submit.mock.calls[0][1].values).not.toHaveProperty('audio');
  });
  it('submits with a saved account connection without reading a guest key or creating a guest job',async()=>{
    render(<KieGenerationWorkspace mediaType="image" inputMode="text" onBack={()=>{}} onOpenConnections={()=>{}}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'Product photo'}});
    fireEvent.click(screen.getByRole('button',{name:'Generate image'}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1]).toMatchObject({provider:'kie',prompt:'Product photo'});
    expect(submit.mock.calls[0][1]).not.toHaveProperty('apiKey');
    expect(submit.mock.calls[0][3]).toBe('owner');
    expect(guestSubmit).not.toHaveBeenCalled();expect(useKieJobsStore.getState().jobs).toHaveLength(0);
    expect(await screen.findByText('Queued')).toBeInTheDocument();
  });
  it('remembers a signed-in prompt in the library once the job is accepted',async()=>{
    render(<KieGenerationWorkspace mediaType="image" inputMode="text" onBack={()=>{}} onOpenConnections={()=>{}}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'Product photo'}});
    fireEvent.click(screen.getByRole('button',{name:'Generate image'}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(usePromptLibraryStore.getState().history.map(p=>p.text)).toEqual(['Product photo']));
  });
  it('remembers the typed text, not the feature-wrapped request, and nothing when the job is refused',async()=>{
    const {result}=renderHook(()=>useCloudWorkspace('kie'));
    await act(async()=>{await result.current.submit({...request,prompt:'Create a VIRAL thumbnail: cat'},[],'cat');});
    expect(usePromptLibraryStore.getState().history.map(p=>p.text)).toEqual(['cat']);
    submit.mockRejectedValueOnce(new Error('Refused'));
    await act(async()=>{await expect(result.current.submit({...request,prompt:'never accepted'},[]).catch(e=>{throw e;})).rejects.toThrow('Refused');});
    expect(usePromptLibraryStore.getState().history.map(p=>p.text)).toEqual(['cat']);
  });
  it('reuses its intake token after a lost response and coalesces double-clicks',async()=>{
    submit.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue({job});
    const {result}=renderHook(()=>useCloudWorkspace('kie'));
    await act(async()=>{await expect(result.current.submit(request,[])).rejects.toThrow('Response lost');});
    await act(async()=>{await Promise.all([result.current.submit(request,[]),result.current.submit(request,[])]);});
    expect(submit).toHaveBeenCalledTimes(2);expect(upload).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toBe(submit.mock.calls[1][0]);
  });
  it('does not submit when the server reports another account',async()=>{
    refresh.mockResolvedValue({...session,account:{...session.account!,id:'other'}});
    const {result}=renderHook(()=>useCloudWorkspace('kie'));
    await act(async()=>{await expect(result.current.submit(request,[])).rejects.toThrow(/account changed/);});
    expect(upload).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();
  });
  it('drops delayed account results after sign-out or switching accounts',()=>{
    const epoch=useAccountStore.getState().epoch;
    useAccountStore.getState().applyJobs('owner',epoch,[job],[]);
    useAccountStore.getState().clear();
    useAccountStore.getState().applySession({...session,account:{...session.account!,id:'other'}});
    useAccountStore.getState().applyJobs('owner',epoch,[job],[]);
    expect(useAccountStore.getState().jobs).toHaveLength(0);
    expect(useAppStore.getState().kieApiKey).toBe('');
  });
  it('never silently falls back when account capacity or provider availability rejects a job',async()=>{
    submit.mockRejectedValue(new Error('Storage quota is full.'));
    render(<KieGenerationWorkspace mediaType="image" inputMode="text" onBack={()=>{}} onOpenConnections={()=>{}}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'Product photo'}});
    fireEvent.click(screen.getByRole('button',{name:'Generate image'}));
    expect(await screen.findByText('Storage quota is full.')).toBeInTheDocument();
    expect(guestSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Switch to in-browser'}));
    expect(screen.getByText(/Runs in this tab/)).toBeInTheDocument();
  });
});
