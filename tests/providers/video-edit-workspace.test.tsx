import { findModel } from '@/lib/providers/catalog';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import VideoSourceInput from '@/components/VideoSourceInput';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';
import { probeDimensions } from '@/lib/timeline/probe';
import { uploadRunwareVideo } from '@/lib/providers/upload-video';
import { submitProviderVideo } from '@/lib/providers/browser';
vi.mock('@/lib/timeline/probe',()=>({probeDimensions:vi.fn().mockResolvedValue({width:1280,height:720,durationSeconds:4})}));
vi.mock('@/lib/providers/upload-video',()=>({uploadRunwareVideo:vi.fn().mockResolvedValue('989ba605-1449-4e1e-b462-cd83ec9c1a67')}));
vi.mock('@/lib/providers/browser',()=>({submitProviderVideo:vi.fn().mockResolvedValue('task'),getProviderVideoStatus:vi.fn(),pollDelayMs:()=>100000}));
vi.mock('@/lib/micro-ai/browser',()=>({requestPromptSlug:vi.fn().mockResolvedValue(null),requestExamplePrompt:vi.fn()}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
beforeEach(()=>{
  useAccountStore.setState({status:'ready',session:null,epoch:0,jobs:[],assets:[]});
  useAppStore.setState({runwareApiKey:'test',runwareVideoModel:'bytedance:seedance@2.5'});
  useDraftStore.setState({prompt:'',references:[],controlValues:{duration:15,size:'1080p · 16:9'}});
  useProviderJobsStore.getState().clearJobs();
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:source'),revokeObjectURL:vi.fn()}));
});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});
it('requires a source, permits no reference images, and submits without stale duration controls',async()=>{
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={()=>{}} onOpenConnections={()=>{}}/>);
  expect(screen.queryByRole('spinbutton',{name:/Duration/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Change scene'}));
  fireEvent.click(screen.getByRole('button',{name:/Generate edit/}));
  expect(screen.getByText('Choose a source video to edit.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Upload source video'),{target:{files:[new File(['clip'],'source.mp4',{type:'video/mp4'})]}});
  await screen.findByText(/source.mp4/);
  fireEvent.click(screen.getByRole('button',{name:/Generate edit/}));
  await waitFor(()=>expect(submitProviderVideo).toHaveBeenCalled());
  expect(uploadRunwareVideo).toHaveBeenCalledTimes(1);
  expect(vi.mocked(submitProviderVideo).mock.calls[0][0]).toMatchObject({inputMode:'edit',images:[],sourceVideo:'989ba605-1449-4e1e-b462-cd83ec9c1a67',size:'720p',durationSeconds:undefined});
  expect(screen.queryByText('Original for comparison')).not.toBeInTheDocument();
});
it('discards a video whose inspection finishes after the account changes',async()=>{
  let resolve!:(value:{width:number;height:number;durationSeconds:number})=>void;
  vi.mocked(probeDimensions).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const onChange=vi.fn();
  render(<VideoSourceInput capability={findModel('runware', 'bytedance:seedance@2.5')!.videoEdit!} source={null} onChange={onChange} disabled={false}/>);
  fireEvent.change(screen.getByLabelText('Upload source video'),{target:{files:[new File(['clip'],'source.mp4',{type:'video/mp4'})]}});
  useAccountStore.setState({epoch:1}); resolve({width:1280,height:720,durationSeconds:4});
  expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed');
  expect(onChange).not.toHaveBeenCalled();
});
it.each([{width:320,height:180},{width:640,height:360}])('rejects an undersized source before upload: $width × $height',async dimensions=>{
  vi.mocked(probeDimensions).mockResolvedValueOnce({...dimensions,durationSeconds:4});
  const onChange=vi.fn();
  render(<VideoSourceInput capability={findModel('runware', 'bytedance:seedance@2.5')!.videoEdit!} source={null} onChange={onChange} disabled={false}/>);
  fireEvent.change(screen.getByLabelText('Upload source video'),{target:{files:[new File(['clip'],'small.mp4',{type:'video/mp4'})]}});
  expect(await screen.findByRole('alert')).toHaveTextContent(/pixels/);
  expect(onChange).not.toHaveBeenCalled();
});

it('submits P-Video-Edit draft without stale Seedance controls', async () => {
  useAppStore.setState({runwareVideoModel:'prunaai:p-video@edit'});
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={()=>{}} onOpenConnections={()=>{}}/>);
  expect(screen.queryByRole('combobox',{name:/Output size/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Change scene'}));
  fireEvent.change(screen.getByLabelText('Upload source video'),{target:{files:[new File(['clip'],'source.mp4',{type:'video/mp4'})]}});
  await screen.findByText(/source.mp4/);
  fireEvent.click(screen.getByRole('checkbox',{name:/Draft mode/}));
  fireEvent.click(screen.getByRole('button',{name:/Generate edit/}));
  await waitFor(()=>expect(submitProviderVideo).toHaveBeenCalled());
  expect(vi.mocked(submitProviderVideo).mock.calls[0][0]).toMatchObject({model:'prunaai:p-video@edit',draft:true,size:undefined,durationSeconds:undefined});
});

it('revalidates an already selected source when switching editing models', async () => {
  vi.mocked(probeDimensions).mockResolvedValueOnce({width:1280,height:720,durationSeconds:20});
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={()=>{}} onOpenConnections={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('Upload source video'),{target:{files:[new File(['clip'],'long.mp4',{type:'video/mp4'})]}});
  await screen.findByText(/long.mp4/);
  fireEvent.click(screen.getByRole('option',{name:/P-Video-Edit/}));
  fireEvent.click(screen.getByRole('button',{name:'Change scene'}));
  fireEvent.click(screen.getByRole('button',{name:/Generate edit/}));
  expect(await screen.findByText(/Choose a readable clip up to 15/)).toBeInTheDocument();
  expect(uploadRunwareVideo).not.toHaveBeenCalled();
  expect(submitProviderVideo).not.toHaveBeenCalled();
});

// Both execution paths must survive the same visible model-switch gesture.
it.each(['browser', 'account'] as const)('keeps the edit result when switching models in %s execution', async execution => {
  const modelId = 'prunaai:p-video@edit';
  const url = execution === 'browser' ? 'https://example.test/edit.mp4' : '/api/account/assets/edit-result/content';
  if (execution === 'browser') {
    useProviderJobsStore.getState().startJob({provider:'runware',modelId,inputMode:'edit',prompt:'Synthetic edit',state:'success',urls:[url]});
  } else {
    useAccountStore.getState().applySession({account:{id:'edit-owner',name:'Test',email:'test@example.test'},googleEnabled:false,localSignIn:true,providers:['runware'],connections:[{id:'connection',provider:'runware',hint:'test',revision:1}]});
    const request = {provider:'runware' as const,modelId,mediaType:'video' as const,inputMode:'edit' as const,prompt:'Synthetic edit',values:{},referenceIds:[]};
    useAccountStore.getState().applyJobs('edit-owner', useAccountStore.getState().epoch, [
      {id:'saved-edit',provider:'runware',request,state:'saved',errorCode:null,createdAt:1,updatedAt:1},
      {id:'pending-edit',provider:'runware',request:{...request,modelId:'bytedance:seedance@2.5',prompt:'Another model is running'},state:'running',errorCode:null,createdAt:2,updatedAt:2},
    ], [{id:'edit-result',jobId:'saved-edit',kind:'video',mimeType:'video/mp4',bytes:100,createdAt:1,metadata:request}]);
  }
  useAppStore.setState({runwareVideoModel:modelId});
  const {container} = render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={()=>{}} onOpenConnections={()=>{}}/>);
  const result = () => container.querySelector('video');
  expect(result()?.getAttribute('src')).toContain(url);
  const originalVideo = result();
  for (const name of [/Seedance 2.5/, /P-Video-Edit/]) {
    fireEvent.click(screen.getByRole('option',{name}));
    expect(result()).toBe(originalVideo);
    expect(result()?.getAttribute('src')).toContain(url);
    expect(screen.getByText('Download video')).toBeInTheDocument();
    if (execution === 'browser') {
      expect(screen.getByRole('heading',{name:'Result'}).closest('section')).toHaveTextContent('P-Video-Edit');
    } else {
      expect(screen.getByText('Another model is running')).toBeInTheDocument();
    }
  }
  if (execution === 'account') {
    act(()=>useAccountStore.getState().applySession({account:{id:'other-owner',name:'Other',email:'other@example.test'},googleEnabled:false,localSignIn:true,providers:['runware'],connections:[]}));
    expect(result()).toBeNull();
  }
});
