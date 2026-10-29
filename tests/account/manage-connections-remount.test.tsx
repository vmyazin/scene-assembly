import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountDashboard from '@/components/account/AccountDashboard';
import { removeConnection } from '@/lib/account/connection-sync';
import { useAccountStore, type AccountConnection } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Irrelevant to this remount, and each fetches or renders media on its own —
// mocked purely to keep the test focused, the same way account-page.test.tsx
// mocks them for the rest of the console's surface.
vi.mock('@/components/account/CloudAssetGrid', () => ({
  default: () => <section>Cloud assets</section>,
}));
vi.mock('@/components/account/AccountDeletion', () => ({ default: () => <section>Deletion</section> }));
vi.mock('@/lib/account/connection-sync', () => ({
  saveBrowserKey: vi.fn(async () => ({ connections: [] })),
  removeConnection: vi.fn(async () => ({ connections: [] })),
}));
vi.mock('@/lib/account/session', () => ({
  accountChanged: vi.fn(),
  // This mock is the honest limit of this test: in production, the epoch bump
  // comes from a same-page BroadcastChannel self-delivery inside
  // AccountSessionProvider (a different `BroadcastChannel` instance receives
  // its own channel's message even in the same tab), which is not mounted or
  // exercised here. What this test does exercise for real is the actual bug
  // mechanism — AccountDashboard keys `AccountConsole` on `epoch`, and React
  // really unmounts/remounts that subtree when the key changes. Bumping epoch
  // directly, the way `refreshAccount` is understood to do downstream of a
  // storage-control write, drives that real remount without standing up the
  // whole cross-tab session-refresh chain.
  refreshAccount: vi.fn(async () => {
    useAccountStore.setState((state) => ({ epoch: state.epoch + 1 }));
  }),
}));

const owner = { id: 'owner-1', name: 'Ada Creator', email: 'ada@example.test' };
const gemini: AccountConnection = { id: 'c1', provider: 'gemini', revision: 1, hint: '4f2a' };

function signedIn() {
  useAccountStore.getState().applySession({
    account: owner, googleEnabled: true, localSignIn: true, providers: ['gemini'], connections: [gemini],
  });
}

describe('the connections dialog on /account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.getState().applySession({ account: null, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
    useAppStore.setState({ apiKey: '', kieApiKey: '', falApiKey: '', cfToken: '', cfAccountId: '', runwareApiKey: '', atlasApiKey: '', cometApiKey: '', accountKeyOptOuts: [] });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('stays open across the remount its own write triggers', async () => {
    signedIn();
    render(<AccountDashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage connections' }));
    expect(screen.getByRole('dialog', { name: 'Connections' })).toBeInTheDocument();

    const initialEpoch = useAccountStore.getState().epoch;
    fireEvent.click(screen.getByRole('button', { name: /Remove from account/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));

    await waitFor(() => {
      expect(removeConnection).toHaveBeenCalledWith('gemini', 'owner-1');
      expect(useAccountStore.getState().epoch).toBeGreaterThan(initialEpoch);
    });

    // Before the fix, `managingKeys` lived inside the keyed `AccountConsole`
    // subtree and this remount discarded it, closing the dialog out from
    // under the click that just used it.
    expect(screen.getByRole('dialog', { name: 'Connections' })).toBeInTheDocument();
  });
});
