import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CloudAssetGrid from '@/components/account/CloudAssetGrid';
import { knownAccountAssetFilenameBase } from '@/lib/account/asset-name';
import type { CloudAsset } from '@/lib/account/contracts';
import { isUploadedAsset } from '@/lib/account/import';
import { useAccountStore } from '@/store/useAccountStore';

vi.mock('@/lib/account/use-library', () => ({ formatAccountBytes: (n: number) => `${n} B` }));

const clip: CloudAsset = {
  id: 'clip-1', kind: 'video', mimeType: 'video/mp4', bytes: 2048, createdAt: 1, jobId: null,
  metadata: { provider: 'local-test', modelId: 'youtube-clip', mediaType: 'video', inputMode: 'edit', prompt: 'Big Buck Bunny 60fps 4K', values: {}, referenceIds: [] },
  origin: { site: 'youtube', videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4, title: 'Big Buck Bunny 60fps 4K' },
};

describe('a YouTube section saved to the library', () => {
  beforeEach(() => {
    useAccountStore.getState().applySession({ account: { id: 'owner-1', name: 'Ada', email: 'ada@example.test' }, googleEnabled: true, localSignIn: true, providers: [], connections: [] });
  });

  it('shows its title and where it came from, and offers no settings to reuse', () => {
    render(<CloudAssetGrid assets={[clip]} ownerId="owner-1" onChanged={vi.fn()} />);
    const card = screen.getByText('Big Buck Bunny 60fps 4K').closest('li')!;
    expect(within(card).getByRole('link', { name: 'From YouTube · 1:02.0–1:14.4' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=62s');
    fireEvent.click(within(card).getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(within(menu).queryByRole('menuitem', { name: 'Reuse settings' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Download video' })).toBeInTheDocument();
  });

  it('counts as uploaded media and downloads under the name it was imported with', () => {
    expect(isUploadedAsset(clip)).toBe(true);
    expect(knownAccountAssetFilenameBase(clip)).toBe('youtube-aqz-KE-bpKQ-62s');
  });
});
