import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import YouTubeClipDialog from '@/components/YouTubeClipDialog';
import { createClipPlayer } from '@/lib/youtube/iframe-api';
import { stageSource, stagedSourceId } from '@/lib/account/staged-sources';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';

const { player, importClip } = vi.hoisted(() => ({
  player: { getCurrentTime: vi.fn(() => 62), getDuration: vi.fn(() => 596), seekTo: vi.fn(), playVideo: vi.fn(), pauseVideo: vi.fn(), destroy: vi.fn() },
  importClip: vi.fn(),
}));
vi.mock('@/lib/youtube/iframe-api', () => ({ createClipPlayer: vi.fn(async () => player) }));
vi.mock('@/lib/account/youtube-clips', () => ({ importYouTubeClip: importClip }));

const target = { provider: 'runware', modelId: 'bytedance:seedance@2.5', modelLabel: 'Seedance 2.5' };
const session: AccountSession = { account: { id: 'owner', name: 'Owner', email: 'o@example.test' }, googleEnabled: true, localSignIn: false, providers: ['runware'], connections: [] };
const file = new File(['mp4'], 'youtube.mp4', { type: 'video/mp4' });
function open(onImported = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) {
  render(<YouTubeClipDialog open target={target} onClose={onClose} onImported={onImported} />);
  return { onImported, onClose };
}
const link = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'YouTube link' }), { target: { value } });
beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); useAccountStore.getState().applySession(session); });

describe('YouTubeClipDialog', () => {
  it('explains a link it cannot use and keeps Import disabled', () => {
    open(); link('https://vimeo.com/1');
    expect(screen.getByRole('alert')).toHaveTextContent('Paste a YouTube video or Shorts link.');
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeDisabled();
  });
  it('pre-fills From from the link, marks the player time, and reads out the length against the model', async () => {
    open(); link('https://youtu.be/aqz-KE-bpKQ?t=62');
    expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('1:02.0');
    await waitFor(() => expect(player.getDuration).toHaveBeenCalled());
    player.getCurrentTime.mockReturnValue(100);
    fireEvent.click(screen.getByRole('button', { name: 'Set end' }));
    expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('1:40.0');
    expect(screen.getByText(/38\.0 s · Seedance 2\.5 takes a 4–30 s source/)).toHaveClass('text-red-300');
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    expect(screen.getByText(/12\.4 s · Seedance 2\.5 takes a 4–30 s source/)).not.toHaveClass('text-red-300');
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeEnabled();
  });
  it('imports the numbers it shows and hands the file on', async () => {
    importClip.mockResolvedValue({ file, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } });
    const { onImported, onClose } = open();
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(importClip).toHaveBeenCalledWith({ url: 'https://youtu.be/aqz-KE-bpKQ?t=62', startSeconds: 62, endSeconds: 74.4, provider: 'runware', modelId: 'bytedance:seedance@2.5', saveToLibrary: false }, expect.any(AbortSignal), 'owner', expect.any(Function));
    expect(onImported).toHaveBeenCalledWith(file, { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 });
  });
  it('drops a clip that finishes after the account changed', async () => {
    let finish!: (value: unknown) => void;
    importClip.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { onImported } = open();
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
    act(() => { useAccountStore.getState().clear(); useAccountStore.getState().applySession({ ...session, account: { id: 'other', name: 'Other', email: 'x@example.test' } }); });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const dropped = new File(['mp4'], 'dropped.mp4', { type: 'video/mp4' });
    stageSource(dropped, { uploadId: 'dropped', owner: 'owner', expiresAt: Date.now() + 86_400_000 });
    try {
      await act(async () => { finish({ file: dropped, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } }); });
      expect(onImported).not.toHaveBeenCalled();
      // Released as the account that imported it; the clip is never attached.
      expect(stagedSourceId(dropped, 'owner')).toBeUndefined();
      await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/account/uploads/dropped', expect.objectContaining({ method: 'DELETE' })));
      expect(new Headers((fetcher.mock.calls[0][1] as RequestInit).headers).get('X-Account-Id')).toBe('owner');
    } finally { vi.unstubAllGlobals(); }
  });
  it('cancels an import in flight and says so', async () => {
    importClip.mockImplementation((_input, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    open();
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
    expect(screen.getByRole('button', { name: /Fetching section/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Import cancelled.');
    expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('1:14.4');
  });

  function startImport() {
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
  }
  const sleep = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });

  it('loops a valid range and stops looping, and pauses, when the range becomes invalid', async () => {
    open(); link('https://youtu.be/aqz-KE-bpKQ?t=62');
    await waitFor(() => expect(player.getDuration).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    player.getCurrentTime.mockReturnValue(200);
    fireEvent.click(screen.getByRole('button', { name: 'Preview range' }));
    expect(screen.getByRole('button', { name: 'Stop preview' })).toBeInTheDocument();
    await sleep(250);
    expect(player.seekTo).toHaveBeenCalledWith(62, true);
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '0:30.0' } });
    expect(screen.getByRole('button', { name: 'Preview range' })).toBeDisabled();
    expect(player.pauseVideo).toHaveBeenCalled();
    player.seekTo.mockClear();
    await sleep(350);
    expect(player.seekTo).not.toHaveBeenCalled();
  });
  it('lets Stop preview end a running loop', async () => {
    open(); link('https://youtu.be/aqz-KE-bpKQ?t=62');
    await waitFor(() => expect(player.getDuration).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop preview' }));
    expect(screen.getByRole('button', { name: 'Preview range' })).toBeEnabled();
    expect(player.pauseVideo).toHaveBeenCalled();
  });
  it('does not cancel a running import on Escape, backdrop or the close button', async () => {
    let signal!: AbortSignal;
    importClip.mockImplementation((_input, given: AbortSignal) => { signal = given; return new Promise(() => {}); });
    const { onClose } = open();
    startImport();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('Fetching section…');
  });
  it('aborts the download and says so when the account changes mid-import', async () => {
    let signal!: AbortSignal;
    importClip.mockImplementation((_input, given: AbortSignal) => { signal = given; return new Promise((_, reject) => given.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); });
    const { onImported } = open();
    startImport();
    act(() => { useAccountStore.getState().clear(); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed. Import the section again.');
    expect(signal.aborted).toBe(true);
    expect(onImported).not.toHaveBeenCalled();
  });
  it('keeps the dialog open with the message when the clip fails validation', async () => {
    importClip.mockResolvedValue({ file, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } });
    const { onClose } = open(vi.fn().mockRejectedValue(new Error('The video is too small.')));
    startImport();
    expect(await screen.findByRole('alert')).toHaveTextContent('The video is too small.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeEnabled();
  });
  it('shows why the player cannot play a video', async () => {
    vi.mocked(createClipPlayer).mockRejectedValueOnce(new Error("This video can't be played here."));
    open(); link('https://youtu.be/aqz-KE-bpKQ');
    expect(await screen.findByRole('alert')).toHaveTextContent("This video can't be played here.");
  });
  it('shows a player error that arrives after the player was ready', async () => {
    vi.mocked(createClipPlayer).mockImplementationOnce(async (_element, _id, hooks) => { setTimeout(() => hooks?.onError?.("This video can't be played here."), 0); return player; });
    open(); link('https://youtu.be/aqz-KE-bpKQ');
    expect(await screen.findByRole('alert')).toHaveTextContent("This video can't be played here.");
  });
  it('reads the duration again when the player reports it late', async () => {
    let hooks: { onStateChange?: (p: typeof player) => void } = {};
    player.getDuration.mockReturnValueOnce(0);
    vi.mocked(createClipPlayer).mockImplementationOnce(async (_element, _id, given) => { hooks = given ?? {}; return player; });
    open(); link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    await waitFor(() => expect(player.getDuration).toHaveBeenCalled());
    expect(document.querySelector('[style*="left"]')).toBeNull();
    act(() => hooks.onStateChange?.(player));
    expect(document.querySelector('[style*="left"]')).not.toBeNull();
  });
  it('asks to save to the library when the box is ticked, and remembers the choice', async () => {
    importClip.mockResolvedValue({ file, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4, savedToLibrary: true } });
    const { onImported, onClose } = open();
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    const box = screen.getByRole('checkbox', { name: /Save to library/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(screen.getByText(/and saved to your library/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(importClip.mock.calls[0][0]).toMatchObject({ saveToLibrary: true });
    expect(onImported).toHaveBeenCalledWith(file, expect.objectContaining({ savedToLibrary: true }));
    expect(JSON.parse(window.localStorage.getItem('scene-assembly:youtube-dialog')!)).toMatchObject({ saveToLibrary: true });
  });
  describe('quick lengths', () => {
    const chip = (seconds: number) => screen.getByRole('button', { name: `Make the section ${seconds} seconds` });
    it('sets To from From and shows which length is chosen', async () => {
      open(); link('https://youtu.be/aqz-KE-bpKQ?t=62');
      await waitFor(() => expect(player.getDuration).toHaveBeenCalled());
      fireEvent.click(chip(7));
      expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('1:09.0');
      expect(chip(7)).toHaveAttribute('aria-pressed', 'true');
      expect(chip(5)).toHaveAttribute('aria-pressed', 'false');
      fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
      expect(chip(7)).toHaveAttribute('aria-pressed', 'false');
    });
    it('is unavailable without a From time, and past the end of the video', async () => {
      open(); link('https://youtu.be/aqz-KE-bpKQ');
      fireEvent.change(screen.getByRole('textbox', { name: 'From' }), { target: { value: '' } });
      expect(chip(5)).toBeDisabled();
      expect(chip(5)).toHaveAttribute('title', 'Set From first.');
      await waitFor(() => expect(player.getDuration).toHaveBeenCalled());
      fireEvent.change(screen.getByRole('textbox', { name: 'From' }), { target: { value: '9:50.0' } });
      expect(chip(5)).toBeEnabled();
      expect(chip(10)).toBeDisabled();
      expect(chip(10)).toHaveAttribute('title', 'That runs past the end of the video.');
    });
  });

  describe('remembered settings', () => {
    it('reopens with the last link, range, length and save choice', () => {
      open(); link('https://youtu.be/aqz-KE-bpKQ?t=62');
      fireEvent.click(screen.getByRole('button', { name: 'Make the section 10 seconds' }));
      fireEvent.click(screen.getByRole('checkbox', { name: /Save to library/ }));
      cleanup();
      open();
      expect(screen.getByRole('textbox', { name: 'YouTube link' })).toHaveValue('https://youtu.be/aqz-KE-bpKQ?t=62');
      expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('1:02.0');
      expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('1:12.0');
      expect(screen.getByRole('checkbox', { name: /Save to library/ })).toBeChecked();
    });
    it('gives a newly pasted video the last quick length', () => {
      window.localStorage.setItem('scene-assembly:youtube-dialog', JSON.stringify({ link: '', from: '0:00.0', to: '', length: 5, saveToLibrary: false }));
      open(); link('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=1m30s');
      expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('1:30.0');
      expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('1:35.0');
    });
  });
});
