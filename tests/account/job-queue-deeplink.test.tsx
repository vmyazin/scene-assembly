import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccountPage from '@/app/account/page';
import type { CloudJobView } from '@/lib/account/contracts';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/lib/account/session', () => ({ refreshAccount: vi.fn(), accountChanged: vi.fn() }));
vi.mock('@/components/account/CloudAssetGrid', () => ({ default: () => <section>Assets</section> }));
vi.mock('@/components/account/AccountConnections', () => ({ default: () => <section>Connections</section> }));
vi.mock('@/components/account/AccountKeyImport', () => ({ default: () => <section>Key import</section> }));
vi.mock('@/components/account/AccountDeletion', () => ({ default: () => <section>Deletion</section> }));

const job = (id: string, state: CloudJobView['state'], errorCode: string | null = null): CloudJobView => ({
  id, provider: 'runware', state, errorCode, createdAt: 1, updatedAt: 1,
  request: {
    provider: 'runware', modelId: 'bytedance:seedance@2.0-mini', mediaType: 'video',
    inputMode: 'text', prompt: 'A canal at dusk', values: {}, referenceIds: [],
  },
});

const stuck = [job('a', 'needs_attention', 'submission_ambiguous'), job('b', 'failed', 'tracking_stopped')];

// The console reads the library hook, not the session store, so the jobs have
// to arrive through it for the filter to have anything to select.
vi.mock('@/lib/account/use-library', () => ({
  useAccountLibrary: () => ({
    // The filter row hides itself without counts, and the filter is the thing
    // under test.
    jobs: stuck, assets: [], storage: null,
    counts: { all: 0, image: 0, video: 0, temporary: 0 }, error: null,
    loading: false, cursor: null, nextCursor: null, page: vi.fn(), refresh: vi.fn(),
  }),
  formatAccountBytes: (n: number) => `${n} B`,
}));

const session: AccountSession = {
  account: { id: 'owner-1', name: 'Ada', email: 'ada@example.test' },
  googleEnabled: true, localSignIn: true, providers: ['runware'], connections: [],
};

/**
 * The queue card is only a count now, so the page it points at has to arrive
 * already showing what was counted. Landing on the asset grid would make the
 * count a dead end — the same "widget you learn to ignore" in a new place.
 */
describe('the account page as the queue card sees it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.getState().applySession(session);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    window.location.hash = '';
    vi.unstubAllGlobals();
  });

  it('opens on the jobs needing a person when sent here by the count', async () => {
    window.location.hash = '#jobs';

    render(<AccountPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Needs attention/ })).toHaveAttribute('aria-pressed', 'true')
    );
    // And the jobs themselves, with the way out of them.
    expect(screen.getAllByText('A canal at dusk', {selector:'p.truncate'})).toHaveLength(2);
    expect(screen.getByText('Tracking stopped')).toBeInTheDocument();
  });

  it('still opens on the library when arriving any other way', async () => {
    render(<AccountPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')
    );
    expect(screen.queryByText('Tracking stopped')).toBeNull();
  });
});
