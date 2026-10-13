import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import YouTubeClipDialog from '@/components/YouTubeClipDialog';
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
beforeEach(() => { vi.clearAllMocks(); useAccountStore.getState().applySession(session); });

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
    expect(screen.getByText(/38\.0 s · Seedance 2\.5 edit takes 4–30 s/)).toHaveClass('text-red-300');
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    expect(screen.getByText(/12\.4 s · Seedance 2\.5 edit takes 4–30 s/)).not.toHaveClass('text-red-300');
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeEnabled();
  });
  it('imports the numbers it shows and hands the file on', async () => {
    importClip.mockResolvedValue({ file, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } });
    const { onImported, onClose } = open();
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(importClip).toHaveBeenCalledWith({ url: 'https://youtu.be/aqz-KE-bpKQ?t=62', startSeconds: 62, endSeconds: 74.4, provider: 'runware', modelId: 'bytedance:seedance@2.5' }, expect.any(AbortSignal), 'owner', expect.any(Function));
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
    await act(async () => { finish({ file, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } }); });
    expect(onImported).not.toHaveBeenCalled();
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
});
