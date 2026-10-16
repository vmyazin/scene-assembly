// tests/providers/video-edit-workspace.test.tsx
import { findModel } from '@/lib/providers/catalog';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import VideoSourceInput from '@/components/VideoSourceInput';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';
import { trimVideoToLimit } from '@/lib/media/trim-video';
import { probeDimensions } from '@/lib/timeline/probe';
import { uploadRunwareVideo } from '@/lib/providers/upload-video';
import { submitProviderVideo } from '@/lib/providers/browser';
vi.mock('@/lib/media/trim-video', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/media/trim-video')>();
  return {...actual, trimVideoToLimit: vi.fn(async (file, dimensions) => ({file,...dimensions}))};
});
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Prompt template' }), { target: { value: 'Change scene' } });
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

it('sends Aleph a data URI and hides reference images', async () => {
  useAppStore.setState({ cometApiKey: 'comet-key', cometVideoModel: 'aleph2' });
  render(<ProviderVideoWorkspace provider="comet" label="CometAPI" inputMode="edit" onBack={() => {}} onOpenConnections={() => {}} />);
  expect(screen.queryByText(/Replacement images/)).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Target aspect ratio' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Prompt template' }), { target: { value: 'Change scene' } });
  fireEvent.change(screen.getByLabelText('Upload source video'), { target: { files: [new File(['clip'], 'source.mp4', { type: 'video/mp4' })] } });
  await screen.findByText(/source.mp4/);
  fireEvent.change(screen.getByRole('combobox', { name: 'Target aspect ratio' }), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: /Generate edit/ }));
  await waitFor(() => expect(submitProviderVideo).toHaveBeenCalled());
  const sent = vi.mocked(submitProviderVideo).mock.calls[0][0];
  expect(sent.model).toBe('aleph2');
  expect(sent.sourceVideo).toMatch(/^data:video\/mp4;base64,/);
  expect(sent.aspectRatio).toBe('16:9');
  expect(uploadRunwareVideo).not.toHaveBeenCalled();
});

it('explains that Aleph takes no character images and will not submit @Image prompts', async () => {
  useAppStore.setState({ cometApiKey: 'comet-key', cometVideoModel: 'aleph2' });
  render(<ProviderVideoWorkspace provider="comet" label="CometAPI" inputMode="edit" onBack={() => {}} onOpenConnections={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Character images' })).toBeInTheDocument();
  expect(screen.getByText(/cannot take character or reference images/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Prompt template' }), { target: { value: 'Replace character' } });
  const prompt = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(prompt.value).toMatch(/^Replace the main person with a woman/);
  expect(prompt.value).not.toMatch(/@(Image|Video)/);
  fireEvent.change(prompt, { target: { value: 'Edit @Video: the person on the left becomes @Image1.' } });
  fireEvent.change(screen.getByLabelText('Upload source video'), { target: { files: [new File(['clip'], 'source.mp4', { type: 'video/mp4' })] } });
  await screen.findByText(/source.mp4/);
  fireEvent.click(screen.getByRole('button', { name: /Generate edit/ }));
  expect(await screen.findByText(/@Image references point to nothing/)).toBeInTheDocument();
  expect(submitProviderVideo).not.toHaveBeenCalled();
});

it('pins each Aleph reference in the shared tray and does not offer a duration', async () => {
  useAppStore.setState({ runwareApiKey: 'test', runwareVideoModel: 'runway:aleph@2.0' });
  useDraftStore.setState({ prompt: 'Change the coat', references: [], controlValues: {} });
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={() => {}} onOpenConnections={() => {}} />);
  expect(screen.queryByRole('spinbutton', { name: /Duration/ })).toBeNull();
  expect(screen.getByText(/2–30 seconds/)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Keep original sound' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Add image'), { target: { files: [new File(['png'], 'coat.png', { type: 'image/png' })] } });
  fireEvent.change(await screen.findByRole('combobox', { name: 'Anchor for image 1' }), { target: { value: 'first' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Prompt template' }), { target: { value: 'Change scene' } });
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toMatch(/@Image/);
  fireEvent.change(screen.getByLabelText('Upload source video'), { target: { files: [new File(['clip'], 'source.mp4', { type: 'video/mp4' })] } });
  await screen.findByText(/source.mp4/);
  fireEvent.click(screen.getByRole('button', { name: /Generate edit/ }));
  await waitFor(() => expect(submitProviderVideo).toHaveBeenCalled());
  expect(vi.mocked(submitProviderVideo).mock.calls[0][0]).toMatchObject({
    model: 'runway:aleph@2.0', frameAnchors: 'first', durationSeconds: undefined, size: undefined,
  });
});

it('offers Keep original sound on Kling O1 and no duration control', () => {
  useAppStore.setState({ runwareApiKey: 'test', runwareVideoModel: 'klingai:kling@o1' });
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={() => {}} onOpenConnections={() => {}} />);
  expect(screen.getByRole('checkbox', { name: 'Keep original sound' })).toBeChecked();
  expect(screen.queryByRole('spinbutton', { name: /Duration/ })).toBeNull();
  expect(screen.getByText(/Up to 30 seconds/)).toBeInTheDocument();
  expect(screen.getByText(/trimmed automatically/)).toBeInTheDocument();
  expect(screen.getByText(/price is not published/)).toBeInTheDocument();
});

it('keeps @Image shortcuts for edit models that take images', () => {
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={() => {}} onOpenConnections={() => {}} />);
  expect(screen.queryByRole('heading', { name: 'Character images' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Prompt template' }), { target: { value: 'Replace character' } });
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('@Image1');
});

it('does not carry Seedance Draft onto P-Video-Edit', () => {
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={()=>{}} onOpenConnections={()=>{}}/>);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Draft' }));
  expect(screen.getByRole('checkbox', { name: 'Draft' })).toBeChecked();
  fireEvent.click(screen.getByRole('option', { name: /P-Video-Edit/ }));
  expect(screen.getByRole('checkbox', { name: 'Draft mode' })).not.toBeChecked();
});

it('does not carry P-Video-Edit Draft mode onto Seedance', () => {
  useAppStore.setState({ runwareVideoModel: 'prunaai:p-video@edit' });
  useDraftStore.setState({ prompt: '', references: [], controlValues: {} });
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={()=>{}} onOpenConnections={()=>{}}/>);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Draft mode' }));
  fireEvent.click(screen.getByRole('option', { name: /Seedance 2\.5/ }));
  expect(screen.getByRole('checkbox', { name: 'Draft' })).not.toBeChecked();
});

it('submits P-Video-Edit draft without stale Seedance controls', async () => {
  useAppStore.setState({runwareVideoModel:'prunaai:p-video@edit'});
  render(<ProviderVideoWorkspace provider="runware" label="Runware" inputMode="edit" onBack={()=>{}} onOpenConnections={()=>{}}/>);
  expect(screen.queryByRole('combobox',{name:/Output size/})).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Prompt template' }), { target: { value: 'Change scene' } });
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Prompt template' }), { target: { value: 'Change scene' } });
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

it('trims a Kling O1 upload at the app ceiling', async () => {
  const capability = findModel('runware', 'klingai:kling@o1')!.videoEdit!;
  vi.mocked(probeDimensions).mockResolvedValueOnce({ width: 1280, height: 720, durationSeconds: 90 });
  render(<VideoSourceInput capability={capability} source={null} onChange={vi.fn()} disabled={false} />);
  fireEvent.change(screen.getByLabelText('Upload source video'), { target: { files: [new File(['clip'], 'long.mp4', { type: 'video/mp4' })] } });
  await waitFor(() => expect(trimVideoToLimit).toHaveBeenCalledWith(
    expect.any(File),
    expect.objectContaining({ durationSeconds: 90 }),
    30,
    expect.any(Object),
  ));
});
it('accepts a trimmed source and revalidates the resulting bytes', async () => {
  const capability = {...findModel('runware', 'bytedance:seedance@2.5')!.videoEdit!, maxSeconds:10.05};
  vi.mocked(probeDimensions).mockResolvedValueOnce({width:1280,height:720,durationSeconds:10.08});
  const trimmed = new File(['trimmed'], 'source-trimmed.mp4', {type:'video/mp4'});
  vi.mocked(trimVideoToLimit).mockResolvedValueOnce({file:trimmed,width:1280,height:720,durationSeconds:9.98,trimmedFromSeconds:10.08});
  const onChange = vi.fn();
  render(<VideoSourceInput capability={capability} source={null} onChange={onChange} disabled={false}/>);
  fireEvent.change(screen.getByLabelText('Upload source video'),{target:{files:[new File(['clip'],'source.mp4',{type:'video/mp4'})]}});
  await waitFor(()=>expect(onChange).toHaveBeenCalledWith(expect.objectContaining({file:trimmed,durationSeconds:9.98,trimNotice:expect.stringContaining('first 9.98 seconds')})));
});
it('does not accept a trim that finishes after changing models', async () => {
  const capability = findModel('runware', 'bytedance:seedance@2.5')!.videoEdit!;
  let resolve!: (value: Awaited<ReturnType<typeof trimVideoToLimit>>) => void;
  vi.mocked(trimVideoToLimit).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const onChange = vi.fn();
  const {rerender} = render(<VideoSourceInput capability={capability} source={null} onChange={onChange} disabled={false}/>);
  const file = new File(['clip'],'source.mp4',{type:'video/mp4'});
  fireEvent.change(screen.getByLabelText('Upload source video'),{target:{files:[file]}});
  await waitFor(()=>expect(resolve).toBeDefined());
  rerender(<VideoSourceInput capability={{...capability,maxSeconds:15}} source={null} onChange={onChange} disabled={false}/>);
  await act(async()=>resolve({file,width:1280,height:720,durationSeconds:4}));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Upload source video')).not.toBeDisabled();
});

it('names an Atlas Kling source with the triple-angle token', () => {
  render(<VideoSourceInput capability={findModel('atlas', 'kwaivgi/kling-video-o3-pro/video-edit')!.videoEdit!} source={null} onChange={() => {}} disabled={false} />);
  expect(screen.getByText(/<<<video_1>>>/)).toBeInTheDocument();
  expect(screen.getByText(/Longer clips are trimmed automatically/)).toBeInTheDocument();
  expect(screen.queryByText(/@Video1/)).not.toBeInTheDocument();
});
