import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionStorageBadge, ConnectionStorageButton } from '@/components/account/ConnectionStorageControl';
import { removeConnection, saveBrowserKey } from '@/lib/account/connection-sync';
import { accountChanged, refreshAccount } from '@/lib/account/session';
import { useAccountStore, type AccountConnection } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';

vi.mock('@/lib/account/connection-sync', () => ({
  saveBrowserKey: vi.fn(async () => ({ connections: [] })),
  removeConnection: vi.fn(async () => ({ connections: [] })),
}));
vi.mock('@/lib/account/session', () => ({ accountChanged: vi.fn(), refreshAccount: vi.fn(async () => undefined) }));

function signIn(connections: AccountConnection[] = []) {
  useAccountStore.getState().applySession({
    account: { id: 'owner-1', name: 'Owner', email: 'owner@example.test' },
    googleEnabled: true, localSignIn: false, providers: [], connections,
  });
}
const gemini = (hint = '4f2a'): AccountConnection => ({ id: 'c1', provider: 'gemini', revision: 1, hint });

describe('ConnectionStorageControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ accountKeyOptOuts: [] });
  });

  it('renders nothing for a guest', () => {
    const { container } = render(<><ConnectionStorageButton provider="gemini" apiKey="AIzaSyLocal" /><ConnectionStorageBadge provider="gemini" apiKey="AIzaSyLocal" /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no key and no connection', () => {
    signIn();
    const { container } = render(<><ConnectionStorageButton provider="gemini" apiKey="" /><ConnectionStorageBadge provider="gemini" apiKey="" /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows both places and offers removal once the account holds the key', () => {
    signIn([gemini()]);
    render(<><ConnectionStorageButton provider="gemini" apiKey="AIzaSyLocal" /><ConnectionStorageBadge provider="gemini" apiKey="AIzaSyLocal" /></>);
    expect(screen.getByText('On this device')).toBeInTheDocument();
    expect(screen.getByText(/Encrypted in your account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove from account/ })).toBeInTheDocument();
  });

  it('names the account copy and warns about browser-only when this device has no key', () => {
    signIn([gemini('9c1d')]);
    render(<><ConnectionStorageButton provider="gemini" apiKey="" /><ConnectionStorageBadge provider="gemini" apiKey="" /></>);
    expect(screen.getByText(/9c1d/)).toBeInTheDocument();
    expect(screen.getByText(/Browser-only runs need a key on this device/)).toBeInTheDocument();
    expect(screen.queryByText('On this device')).not.toBeInTheDocument();
    // The vault is write-only, so this is the one state where the account's
    // copy cannot be recovered if removed — the button must still be offered,
    // but only behind the confirm.
    fireEvent.click(screen.getByRole('button', { name: /Remove from account/ }));
    expect(screen.getByRole('alertdialog', { name: 'Remove this connection?' })).toBeInTheDocument();
    expect(removeConnection).not.toHaveBeenCalled();
  });

  it('offers Save to account only for a provider that was opted out', () => {
    signIn();
    useAppStore.setState({ accountKeyOptOuts: ['gemini'] });
    render(<><ConnectionStorageButton provider="gemini" apiKey="AIzaSyLocal" /><ConnectionStorageBadge provider="gemini" apiKey="AIzaSyLocal" /></>);
    expect(screen.getByText('On this device')).toBeInTheDocument();
    expect(screen.getByText('Not in your account')).toBeInTheDocument();
    expect(screen.getByText('Kept off your account, so cloud jobs cannot use it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save to account/ })).toBeInTheDocument();
  });

  it('shows no button while a key is waiting for the next Save & close', () => {
    signIn();
    render(<><ConnectionStorageButton provider="gemini" apiKey="AIzaSyLocal" /><ConnectionStorageBadge provider="gemini" apiKey="AIzaSyLocal" /></>);
    expect(screen.getByText('On this device')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('removing sets the opt-out so the next sync leaves it alone', async () => {
    signIn([gemini()]);
    render(<><ConnectionStorageButton provider="gemini" apiKey="AIzaSyLocal" /><ConnectionStorageBadge provider="gemini" apiKey="AIzaSyLocal" /></>);
    fireEvent.click(screen.getByRole('button', { name: /Remove from account/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
    await waitFor(() => expect(removeConnection).toHaveBeenCalledWith('gemini', 'owner-1'));
    expect(useAppStore.getState().accountKeyOptOuts).toEqual(['gemini']);
  });

  it('cancelling the confirm leaves the connection untouched', async () => {
    signIn([gemini()]);
    render(<><ConnectionStorageButton provider="gemini" apiKey="AIzaSyLocal" /><ConnectionStorageBadge provider="gemini" apiKey="AIzaSyLocal" /></>);
    fireEvent.click(screen.getByRole('button', { name: /Remove from account/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // The dialog stays mounted so its exit animation can play.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(removeConnection).not.toHaveBeenCalled();
  });

  it('saving clears the opt-out and sends the key that is on screen', async () => {
    signIn();
    useAppStore.setState({ accountKeyOptOuts: ['cloudflare'] });
    render(<><ConnectionStorageButton provider="cloudflare" apiKey="cf-token-value" accountId={'a'.repeat(32)} /><ConnectionStorageBadge provider="cloudflare" apiKey="cf-token-value" /></>);
    fireEvent.click(screen.getByRole('button', { name: /Save to account/ }));
    await waitFor(() =>
      expect(saveBrowserKey).toHaveBeenCalledWith(
        { provider: 'cloudflare', apiKey: 'cf-token-value', accountId: 'a'.repeat(32) },
        'owner-1'
      )
    );
    expect(useAppStore.getState().accountKeyOptOuts).toEqual([]);
  });

  it('ignores a stale removal result once a different account has signed in', async () => {
    signIn([gemini()]);
    let resolveRemoval: (value: { connections: AccountConnection[] }) => void = () => {};
    vi.mocked(removeConnection).mockReturnValueOnce(
      new Promise((resolve) => { resolveRemoval = resolve; })
    );
    render(<><ConnectionStorageButton provider="gemini" apiKey="AIzaSyLocal" /><ConnectionStorageBadge provider="gemini" apiKey="AIzaSyLocal" /></>);
    fireEvent.click(screen.getByRole('button', { name: /Remove from account/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
    await waitFor(() => expect(removeConnection).toHaveBeenCalledWith('gemini', 'owner-1'));

    // A different account signs in before the removal resolves. This bumps
    // `epoch`, so the pending request's identity no longer matches.
    act(() => {
      useAccountStore.getState().applySession({
        account: { id: 'owner-2', name: 'Other', email: 'other@example.test' },
        googleEnabled: true, localSignIn: false, providers: [], connections: [],
      });
    });

    await act(async () => {
      resolveRemoval({ connections: [] });
      await Promise.resolve();
    });

    expect(useAppStore.getState().accountKeyOptOuts).toEqual([]);
    expect(accountChanged).not.toHaveBeenCalled();
    expect(refreshAccount).not.toHaveBeenCalled();
  });

  it('keeps the connection and reports the failure when removal fails', async () => {
    signIn([gemini()]);
    vi.mocked(removeConnection).mockRejectedValueOnce(new Error('Network unavailable.'));
    render(<><ConnectionStorageButton provider="gemini" apiKey="AIzaSyLocal" /><ConnectionStorageBadge provider="gemini" apiKey="AIzaSyLocal" /></>);
    fireEvent.click(screen.getByRole('button', { name: /Remove from account/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable.');
    expect(useAppStore.getState().accountKeyOptOuts).toEqual([]);
  });
});
