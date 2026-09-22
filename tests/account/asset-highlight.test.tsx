import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccountPage from '@/app/account/page';
import CloudAssetGrid from '@/components/account/CloudAssetGrid';
import type { CloudAsset, CloudJobRequest } from '@/lib/account/contracts';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/account/session', () => ({ refreshAccount: vi.fn(), accountChanged: vi.fn() }));
vi.mock('@/components/account/AccountConnections', () => ({ default: () => <section>Connections</section> }));
vi.mock('@/components/account/AccountKeyImport', () => ({ default: () => <section>Key import</section> }));
vi.mock('@/components/account/AccountDeletion', () => ({ default: () => <section>Deletion</section> }));

const request: CloudJobRequest = { provider: 'gemini', modelId: 'image-model', mediaType: 'image', inputMode: 'text', prompt: 'A canal at dusk', values: {}, referenceIds: [] };
const first: CloudAsset = { id: 'image-1', kind: 'image', mimeType: 'image/png', bytes: 1200, createdAt: 2, metadata: request, jobId: 'job-1' };
const second: CloudAsset = { id: 'image-2', kind: 'image', mimeType: 'image/png', bytes: 1200, createdAt: 1, metadata: { ...request, prompt: 'A tram at dawn' }, jobId: 'job-2' };

vi.mock('@/lib/account/use-library', () => ({
  useAccountLibrary: () => ({
    jobs: [], assets: [first, second], storage: null,
    counts: { all: 2, image: 2, video: 0, temporary: 0 }, error: null,
    loading: false, cursor: null, nextCursor: null, page: vi.fn(), refresh: vi.fn(),
  }),
  formatAccountBytes: (n: number) => `${n} B`,
}));

const session: AccountSession = {
  account: { id: 'owner-1', name: 'Ada', email: 'ada@example.test' },
  googleEnabled: true, localSignIn: true, providers: ['gemini'], connections: [],
};

function card(prompt: string) {
  return screen.getByText(prompt).closest('li');
}

describe('the cloud library card a job queue row points at', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.getState().applySession(session);
    vi.stubGlobal('fetch', vi.fn());
    // jsdom has no layout, so the grid's scroll-into-view would throw.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    window.location.hash = '';
    vi.unstubAllGlobals();
  });

  it('singles out the one it was given and leaves the rest alone', () => {
    render(<CloudAssetGrid assets={[first, second]} ownerId="owner-1" highlightAssetId="image-2" onChanged={vi.fn()} />);

    expect(card('A tram at dawn')).toHaveAttribute('aria-current', 'true');
    expect(card('A tram at dawn')).toHaveAttribute('id', 'asset-image-2');
    expect(card('A canal at dusk')).not.toHaveAttribute('aria-current');
    // And brings it to the reader rather than leaving them to find the outline.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('claims no anchor ids unless a grid is the one being linked to', () => {
    // Two grids can be mounted at once — the console behind the studio header's
    // library overlay — and duplicate ids would send the deep link to whichever
    // rendered first.
    render(<CloudAssetGrid assets={[first]} ownerId="owner-1" onChanged={vi.fn()} />);

    expect(card('A canal at dusk')).not.toHaveAttribute('id');
  });

  it('moves the highlight when the link is clicked from /account itself', async () => {
    // Same-document hash navigation remounts nothing, so the console has to hear
    // the change rather than only read it once.
    render(<AccountPage />);
    await waitFor(() => expect(card('A canal at dusk')).toBeInTheDocument());

    act(() => {
      window.location.hash = '#asset-image-1';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => expect(card('A canal at dusk')).toHaveAttribute('aria-current', 'true'));
  });

  it('opens the library on the asset when sent here by a succeeded queue row', async () => {
    window.location.hash = '#asset-image-2';

    render(<AccountPage />);

    await waitFor(() => expect(card('A tram at dawn')).toHaveAttribute('aria-current', 'true'));
    // The asset lives in the grid, so the console has to be showing the grid.
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
