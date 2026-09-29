import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountLibrary from '@/components/account/AccountLibrary';
import type { CloudAsset, CloudJobRequest } from '@/lib/account/contracts';
import { accountRequest } from '@/lib/account/client';
import { useAccountStore } from '@/store/useAccountStore';

vi.mock('@/lib/account/client', () => ({
  accountRequest: vi.fn(),
  accountAssetUrl: vi.fn(),
}));

const request:CloudJobRequest={provider:'gemini',modelId:'image-model',mediaType:'image',inputMode:'text',prompt:'Cloud image',values:{},referenceIds:[]};
const image:CloudAsset={id:'image-1',kind:'image',mimeType:'image/png',bytes:1200,createdAt:2,metadata:request,jobId:'job-1'};
const video:CloudAsset={id:'video-1',kind:'video',mimeType:'video/mp4',bytes:2400,createdAt:1,metadata:{...request,mediaType:'video',prompt:'Cloud video'},jobId:'job-2',startedBy:{agentId:'a1',name:'Claude Code'}};

function applyOwner(id='owner-1'){
  useAccountStore.getState().applySession({account:{id,name:'Owner',email:'owner@example.test'},googleEnabled:true,localSignIn:false,providers:[],connections:[]});
}

describe('AccountLibrary',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    applyOwner();
    vi.mocked(accountRequest).mockImplementation(async(path)=>{
      if(path==='jobs')return {jobs:[]};
      if(path==='storage')return {storage:{limitBytes:1_000_000_000,usedBytes:3600,reservedBytes:0,activeJobs:0}};
      if(path==='assets')return {assets:[video],nextCursor:'older-page'};
      if(path==='assets?cursor=older-page')return {assets:[image,video],nextCursor:null};
      throw new Error(`Unexpected path: ${path}`);
    });
  });

  it('filters picker pages to images and can paginate past a video-only page',async()=>{
    render(<AccountLibrary ownerId="owner-1" mode="pick-image" referenceLimit={2}/>);

    expect(await screen.findByText('No cloud images on this page.')).toBeInTheDocument();
    expect(screen.queryByText('Cloud video')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Older assets'}));

    expect(await screen.findByText('Cloud image')).toBeInTheDocument();
    expect(screen.queryByText('Cloud video')).toBeNull();
    expect(screen.getByRole('button',{name:'Latest assets'})).toBeInTheDocument();
    await waitFor(()=>expect(accountRequest).toHaveBeenCalledWith('assets?cursor=older-page',expect.objectContaining({headers:{'X-Account-Id':'owner-1'}})));
  });

  it('marks an asset an agent started',async()=>{
    render(<AccountLibrary ownerId="owner-1"/>);

    expect(await screen.findByText('Cloud video')).toBeInTheDocument();
    expect(await screen.findByText(/via Claude Code/)).toBeInTheDocument();
  });

  it('shows a recoverable load error',async()=>{
    vi.mocked(accountRequest).mockRejectedValueOnce(new Error('Cloud is unavailable'));
    render(<AccountLibrary ownerId="owner-1"/>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Cloud is unavailable');
    expect(screen.getByRole('button',{name:'Try again'})).toBeInTheDocument();
  });
});
