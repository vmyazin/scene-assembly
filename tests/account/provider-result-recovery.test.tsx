import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CloudJobList from '@/components/account/CloudJobList';
import { useAccountStore } from '@/store/useAccountStore';
import type { CloudJobView } from '@/lib/account/contracts';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/account/client',()=>({accountRequest:request}));
const job:CloudJobView={id:'blocked-job',provider:'atlas',state:'needs_attention',failureReason:'result_location',errorCode:'save_failed',attempts:0,createdAt:1,updatedAt:1,request:{provider:'atlas',modelId:'video',mediaType:'video',inputMode:'text',prompt:'Local recovery fixture',values:{},referenceIds:[]}};
const recovery={links:[{url:'https://cdn.example.com/file.mp4?signature=private',hostname:'cdn.example.com'}],providerTaskId:'provider-task-123'};
beforeEach(()=>{
  vi.clearAllMocks();
  useAccountStore.getState().applySession({account:{id:'owner',name:'Local creator',email:'local@example.test'},googleEnabled:false,localSignIn:true,providers:[],connections:[]});
  request.mockResolvedValue(recovery);
});
it('makes the current-policy retry explicit, with no paid regeneration',()=>{
  const resume=vi.fn();
  render(<CloudJobList jobs={[{...job,canRetrySave:true}]} onResume={resume}/>);
  expect(screen.getByText(/without generating again/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry saving'}));
  expect(resume).toHaveBeenCalledWith(job.id);
});
it('retrieves links only on request, showing the external host without fetching the file',async()=>{
  render(<CloudJobList jobs={[job]} onResume={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Retry saving'})).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Get provider download'}));
  const link=await screen.findByRole('link',{name:/Open result on cdn.example.com/});
  expect(link).toHaveAttribute('href',recovery.links[0].url);
  expect(link).toHaveAttribute('rel','noopener noreferrer');
  expect(link).toHaveAttribute('referrerpolicy','no-referrer');
  expect(request).toHaveBeenCalledExactlyOnceWith('jobs/blocked-job/recovery');
  expect(screen.getByText(/These links may expire/)).toBeInTheDocument();
});
it('discards an in-flight response when the account changes',async()=>{
  let resolve!:(data:typeof recovery)=>void;
  request.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  render(<CloudJobList jobs={[job]} onResume={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Get provider download'}));
  await act(async()=>{useAccountStore.getState().applySession({account:null,googleEnabled:false,localSignIn:true,providers:[],connections:[]});resolve(recovery);});
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('hides already-loaded links on account changes and permits a failed request to retry',async()=>{
  request.mockRejectedValueOnce(new Error('Connection interrupted. Try again.'));
  render(<CloudJobList jobs={[job]} onResume={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Get provider download'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
  fireEvent.click(screen.getByRole('button',{name:'Get provider download'}));
  await screen.findByRole('link');
  act(()=>useAccountStore.getState().applySession({account:null,googleEnabled:false,localSignIn:true,providers:[],connections:[]}));
  await waitFor(()=>expect(screen.queryByRole('link')).not.toBeInTheDocument());
});
it('keeps manual recovery when save retries are exhausted, and provides a reference when there is no usable link',async()=>{
  request.mockResolvedValue({links:[],providerTaskId:'provider-task-123'});
  render(<CloudJobList jobs={[{...job,canRetrySave:true,attempts:3}]} onResume={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Retry saving'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Get provider download'}));
  expect(await screen.findByText('provider-task-123')).toBeInTheDocument();
  expect(screen.getByText(/Ask the provider to recover/)).toBeInTheDocument();
});
