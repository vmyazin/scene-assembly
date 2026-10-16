import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
import ReferenceClipTray, {type AttachedReferenceClip} from '@/components/ReferenceClipTray';
import {SEEDANCE_25_REFERENCE_CLIPS} from '@/lib/providers/reference-clips';
import {probeDimensions} from '@/lib/timeline/probe';
import {trimVideoToLimit} from '@/lib/media/trim-video';
vi.mock('@/lib/timeline/probe',()=>({probeDimensions:vi.fn(),probeWithDemuxer:vi.fn()}));
vi.mock('@/lib/media/trim-video',async importOriginal=>({...await importOriginal<typeof import('@/lib/media/trim-video')>(),trimVideoToLimit:vi.fn()}));
beforeEach(()=>vi.resetAllMocks());
function setup(existing: AttachedReferenceClip[] = []) {
  const onVideos=vi.fn();
  render(<ReferenceClipTray capability={SEEDANCE_25_REFERENCE_CLIPS} syntax="at-image-index" videos={existing} audios={[]} onVideos={onVideos} onAudios={()=>{}} disabled={false} hostedOnly={false} epoch={{current:1}}/>);
  return onVideos;
}
it('fits a reference video to the remaining total and retains the actual output duration',async()=>{
  const file=new File(['clip'],'long.mp4',{type:'video/mp4'});
  const trimmed=new File(['trimmed'],'long-trimmed.mp4',{type:'video/mp4'});
  vi.mocked(probeDimensions).mockResolvedValueOnce({width:1280,height:720,durationSeconds:20}).mockResolvedValueOnce({width:1280,height:720,durationSeconds:9.92});
  vi.mocked(trimVideoToLimit).mockResolvedValue({file:trimmed,width:1280,height:720,durationSeconds:9.92,trimmedFromSeconds:20});
  const onVideos=setup([{id:'old',kind:'video',file,durationSeconds:20}]);
  fireEvent.change(screen.getByLabelText('Upload reference video'),{target:{files:[file]}});
  await waitFor(()=>expect(onVideos).toHaveBeenCalled());
  expect(vi.mocked(trimVideoToLimit).mock.calls[0][2]).toBe(10);
  expect(onVideos.mock.calls[0][0][1]).toMatchObject({file:trimmed,durationSeconds:9.92,trimNotice:expect.stringContaining('first 9.92 seconds')});
});
it('rejects a too-short video without attempting a trim',async()=>{
  vi.mocked(probeDimensions).mockResolvedValue({width:1280,height:720,durationSeconds:1});
  const onVideos=setup();
  fireEvent.change(screen.getByLabelText('Upload reference video'),{target:{files:[new File(['clip'],'short.mp4',{type:'video/mp4'})]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('must be');
  expect(trimVideoToLimit).not.toHaveBeenCalled();
  expect(onVideos).toHaveBeenCalledWith([]);
});
