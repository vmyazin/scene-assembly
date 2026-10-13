import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VideoSourceInput, { type SourceVideo } from '@/components/VideoSourceInput';
import { stageSource, stagedSourceId } from '@/lib/account/staged-sources';
import { probeDimensions } from '@/lib/timeline/probe';

vi.mock('@/lib/youtube/iframe-api', () => ({ createClipPlayer: vi.fn() }));
vi.mock('@/lib/timeline/probe', () => ({ probeDimensions: vi.fn(async () => ({ width: 1280, height: 720, durationSeconds: 10 })) }));
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(probeDimensions).mockClear(); });
const capability = { minSeconds: 4, maxSeconds: 30, sizes: [], maxImages: 5, rate: { per: 'second' as const, usd: 0.1 } };
const file = new File(['mp4'], 'youtube-aqz-KE-bpKQ-62s.mp4', { type: 'video/mp4' });

describe('VideoSourceInput', () => {
  it('offers From YouTube only when given a target', () => {
    const { rerender } = render(<VideoSourceInput capability={capability} source={null} onChange={() => {}} disabled={false} />);
    expect(screen.queryByRole('button', { name: /From YouTube/ })).toBeNull();
    rerender(<VideoSourceInput capability={capability} source={null} onChange={() => {}} disabled={false} youtube={{ provider: 'runware', modelId: 'bytedance:seedance@2.5', modelLabel: 'Seedance 2.5' }} />);
    expect(screen.getByRole('button', { name: /From YouTube/ })).toBeEnabled();
  });
  it('labels an imported source with its origin and range', () => {
    render(<VideoSourceInput capability={capability} disabled={false} onChange={() => {}}
      source={{ file, epoch: 0, width: 1280, height: 720, durationSeconds: 12.4, origin: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } }} />);
    expect(screen.getByRole('link', { name: 'From YouTube · 1:02.0–1:14.4' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=62s');
  });
  describe('releases a staged import it no longer uses', () => {
    const staged = (id: string): SourceVideo => {
      const clip = new File(['mp4'], `${id}.mp4`, { type: 'video/mp4' });
      stageSource(clip, { uploadId: id, owner: 'owner', expiresAt: Date.now() + 86_400_000 });
      return { file: clip, epoch: 0, width: 1280, height: 720, durationSeconds: 10, origin: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 72 } };
    };
    const deletes = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'DELETE').map(([url]) => url);
    const upload = (next: File) => fireEvent.change(screen.getByLabelText('Upload source video'), { target: { files: [next] } });
    it('on Remove', async () => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
      vi.stubGlobal('fetch', fetcher);
      const onChange = vi.fn();
      const source = staged('removed');
      render(<VideoSourceInput capability={capability} disabled={false} onChange={onChange} source={source} />);
      fireEvent.click(screen.getByRole('button', { name: 'Remove source video' }));
      expect(onChange).toHaveBeenCalledWith(null);
      await waitFor(() => expect(deletes(fetcher)).toEqual(['/api/account/uploads/removed']));
      expect(stagedSourceId(source.file, 'owner')).toBeUndefined();
    });
    it('on Replace, and not when the replacement fails to read', async () => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
      vi.stubGlobal('fetch', fetcher);
      const onChange = vi.fn();
      const source = staged('replaced');
      render(<VideoSourceInput capability={capability} disabled={false} onChange={onChange} source={source} />);
      vi.mocked(probeDimensions).mockRejectedValueOnce(new Error('Could not read that video.'));
      upload(new File(['mp4'], 'broken.mp4', { type: 'video/mp4' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not read that video.');
      expect(deletes(fetcher)).toEqual([]);
      const next = new File(['mp4'], 'device.mp4', { type: 'video/mp4' });
      upload(next);
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ file: next })));
      await waitFor(() => expect(deletes(fetcher)).toEqual(['/api/account/uploads/replaced']));
    });
    it('when an imported clip fails validation and never becomes the source', async () => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
      vi.stubGlobal('fetch', fetcher);
      const onChange = vi.fn();
      render(<VideoSourceInput capability={capability} disabled={false} onChange={onChange} source={null} />);
      const tooShort = staged('too-short');
      vi.mocked(probeDimensions).mockResolvedValueOnce({ width: 1280, height: 720, durationSeconds: 2 });
      upload(tooShort.file);
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => expect(deletes(fetcher)).toEqual(['/api/account/uploads/too-short']));
    });
  });
});
