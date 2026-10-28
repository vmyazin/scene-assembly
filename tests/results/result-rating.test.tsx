import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ResultRating from '@/components/ResultRating';
import { createMemoryGalleryStorage } from '@/lib/gallery/memory-storage';
import type { CloudAsset } from '@/lib/account/contracts';
import { configureGalleryStorage, useGalleryStore } from '@/store/useGalleryStore';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';

vi.mock('@/lib/account/session', () => ({ refreshAccount: vi.fn(), accountChanged: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const session: AccountSession = {
  account: { id: 'owner-1', name: 'Ada', email: 'ada@example.test' },
  googleEnabled: true, localSignIn: true, providers: ['runware'], connections: [],
};
const clip: CloudAsset = {
  id: 'clip-1', kind: 'video', mimeType: 'video/mp4', bytes: 10, createdAt: 1, jobId: 'job-1',
  metadata: { provider: 'runware', modelId: 'bytedance:seedance@2.5', mediaType: 'video', inputMode: 'text', prompt: 'A fox at dawn', values: {}, referenceIds: [] },
};

describe('ResultRating', () => {
  beforeEach(() => {
    configureGalleryStorage(createMemoryGalleryStorage());
    useGalleryStore.setState({ records: [], hydrated: true, storageError: null });
  });

  it('waits for the result to be filed before offering a rating', () => {
    const { container } = render(<ResultRating target={{ kind: 'browser', recordId: 'runware-job-1' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rates the browser library record the result was filed as', async () => {
    await useGalleryStore.getState().record({
      id: 'runware-job-1', kind: 'video', prompt: 'A fox at dawn', provider: 'runware',
      modelId: 'bytedance:seedance@2.5', controlValues: {}, mimeType: 'video/mp4',
    });
    render(<ResultRating target={{ kind: 'browser', recordId: 'runware-job-1' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Great' }));

    await waitFor(() => expect(useGalleryStore.getState().records[0]).toMatchObject({ rating: 'great', pinned: true }));
    expect(screen.getByRole('button', { name: 'Great' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves a cloud rating to the account and shows what the Worker kept', async () => {
    useAccountStore.getState().applySession(session);
    const { epoch } = useAccountStore.getState();
    useAccountStore.getState().applyJobs('owner-1', epoch, [], [clip]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ asset: { ...clip, rating: 'down' } })));
    vi.stubGlobal('fetch', fetchMock);
    render(<ResultRating target={{ kind: 'cloud', assetId: 'clip-1' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Miss' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Miss' })).toHaveAttribute('aria-pressed', 'true'));
    expect(fetchMock).toHaveBeenCalledWith('/api/account/assets/clip-1/rating', expect.objectContaining({ method: 'POST', body: JSON.stringify({ rating: 'down' }) }));
    expect(useAccountStore.getState().assets[0].rating).toBe('down');
  });
});
