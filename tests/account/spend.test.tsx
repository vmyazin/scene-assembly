import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountSpend from '@/components/spend/AccountSpend';
import SpendPage from '@/app/spend/page';
import { accountRequest } from '@/lib/account/client';
import type { SpendEntry } from '@/lib/spend/ledger';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { useSpendStore } from '@/store/useSpendStore';

vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock('@/lib/kie/browser', () => ({ fetchKieCredits: vi.fn() }));
vi.mock('@/lib/account/client', () => ({ accountRequest: vi.fn() }));

function entry(id: string, promptExcerpt: string, at = Date.now()): SpendEntry {
  return {
    id,
    at,
    provider: 'gemini',
    modelId: 'gemini-3-pro-image-preview',
    kind: 'image',
    costUsd: 0.12,
    confidence: 'exact',
    source: 'usage-metadata',
    promptExcerpt,
  };
}

function owner(id = 'owner-1') {
  useAccountStore.getState().applySession({
    account: { id, name: 'Owner', email: 'owner@example.test' },
    googleEnabled: true,
    localSignIn: false,
    providers: [],
    connections: [],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('account spend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSpendStore.setState({ entries: [entry('guest', 'Browser record')], hasHydrated: true });
    useAppStore.setState({ kieApiKey: '', hasHydrated: true });
    owner();
  });

  it('shows all-time spend independently of the range and loaded ledger page', async () => {
    vi.mocked(accountRequest).mockImplementation(async (path) => {
      if (path === 'spend') return { accountId: 'owner-1', entries: [entry('cloud', 'Newest')], nextCursor: 'older' };
      const costUsd = path === 'spend/totals' ? 125 : 12;
      return { accountId: 'owner-1', totals: { costUsd, runs: 100, exactUsd: costUsd, estimatedUsd: 0, unknownRuns: 0 } };
    });
    render(<AccountSpend ownerId="owner-1" range="month" onRangeChange={vi.fn()} now={Date.now()} onClearRequest={vi.fn()} />);

    // The overview arrives with the first rows, so wait for the tile before reading it.
    expect(await within(await screen.findByRole('region', { name: 'All-time spend' })).findByText('$125.00')).toBeInTheDocument();
    expect(await screen.findByText('Newest')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary' })).toHaveTextContent('$12.00');
    expect(accountRequest).toHaveBeenCalledWith('spend/totals', expect.objectContaining({ headers: { 'X-Account-Id': 'owner-1' } }));
  });

  it('does not substitute loaded rows when the all-time endpoint fails and can retry', async () => {
    let failed = true;
    vi.mocked(accountRequest).mockImplementation(async (path) => {
      if (path === 'spend') return { accountId: 'owner-1', entries: [entry('cloud', 'Newest')], nextCursor: 'older' };
      if (path === 'spend/totals' && failed) throw new Error('Unavailable');
      return { accountId: 'owner-1', totals: { costUsd: 125, runs: 100, exactUsd: 125, estimatedUsd: 0, unknownRuns: 0 } };
    });
    render(<AccountSpend ownerId="owner-1" range="month" onRangeChange={vi.fn()} now={Date.now()} onClearRequest={vi.fn()} />);

    const total = within(await screen.findByRole('region', { name: 'All-time spend' }));
    expect(await total.findByText('Total spend is temporarily unavailable.')).toBeInTheDocument();
    expect(total.getByText('—')).toBeInTheDocument();
    failed = false;
    fireEvent.click(total.getByRole('button', { name: 'Retry total' }));
    expect(await total.findByText('$125.00')).toBeInTheDocument();
  });

  it('shows only the signed-in account ledger without a source toggle', async () => {
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'owner-1', entries: [entry('cloud', 'Cloud record')], nextCursor: null });
    render(<SpendPage />);

    expect(await screen.findByText('Cloud record')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
    expect(screen.queryByText('Browser record')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Cloud account' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'This browser' })).toBeNull();
    expect(useSpendStore.getState().entries.map((item) => item.id)).toEqual(['guest']);
  });

  it('shows the range selector in the same paint as the first account rows', async () => {
    // A MutationObserver callback runs straight after a commit, before React's
    // passive effects. Reporting "has records" from one of those left a frame
    // with rows on screen and no range control, which is where the test above
    // used to fail under load.
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'owner-1', entries: [entry('cloud', 'Cloud record')], nextCursor: null });
    const rangeWithFirstRows = new Promise<boolean>((done) => {
      const observer = new MutationObserver(() => {
        if (!document.body.textContent?.includes('Cloud record')) return;
        observer.disconnect();
        done(screen.queryByRole('radiogroup', { name: 'Range' }) !== null);
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    render(<SpendPage />);

    expect(await rangeWithFirstRows).toBe(true);
  });

  it('hides the range selector until something has been recorded', async () => {
    useAccountStore.getState().applySession({ account: null, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
    useSpendStore.setState({ entries: [], hasHydrated: true });
    render(<SpendPage />);

    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('Per day')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Range' })).toBeNull();

    useSpendStore.setState({ entries: [entry('guest', 'Browser record')] });
    expect(await screen.findByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
  });

  it('hides the range selector for an account with no records', async () => {
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'owner-1', entries: [], nextCursor: null });
    render(<SpendPage />);

    expect(await screen.findByText('Nothing recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('Per day')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Range' })).toBeNull();
  });

  it('shows the browser ledger for guests without a source toggle', () => {
    useAccountStore.getState().applySession({ account: null, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
    render(<SpendPage />);

    expect(screen.getByText('Browser record')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Cloud account' })).toBeNull();
    expect(accountRequest).not.toHaveBeenCalled();
  });

  it('discards a pending read after logout and aborts it when the owner changes', async () => {
    const first = deferred<{ accountId: string; entries: SpendEntry[]; nextCursor: null }>();
    const signals: AbortSignal[] = [];
    vi.mocked(accountRequest).mockImplementation(async (path, init) => {
      if (path !== 'spend') return new Promise(() => {});
      if (init?.signal) signals.push(init.signal);
      return first.promise;
    });
    render(<SpendPage />);
    await waitFor(() => expect(signals).toHaveLength(1));

    owner('owner-2');
    await waitFor(() => expect(signals[0].aborted).toBe(true));
    useAccountStore.getState().applySession({ account: null, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
    first.resolve({ accountId: 'owner-1', entries: [entry('stale', 'Stale cloud record')], nextCursor: null });

    expect(await screen.findByText('Browser record')).toBeInTheDocument();
    expect(screen.queryByText('Stale cloud record')).toBeNull();
  });

  it('shows the Worker range total instead of summing the first loaded page', async () => {
    vi.mocked(accountRequest).mockImplementation(async (path) => {
      if (path === 'spend') return { accountId: 'owner-1', entries: [entry('new', 'Newest')], nextCursor: '100:old' };
      if (path.startsWith('spend/totals')) return {
        accountId: 'owner-1',
        totals: { costUsd: 5.24, runs: 120, exactUsd: 5, estimatedUsd: 0.24, unknownRuns: 3 },
      };
      throw new Error(`Unexpected path: ${path}`);
    });
    render(<SpendPage />);

    const summary = await screen.findByRole('region', { name: 'Summary' });
    await waitFor(() => expect(summary).toHaveTextContent('$5.24'));
    expect(summary).toHaveTextContent('3 runs unpriced');
    expect(screen.getByRole('region', { name: 'Runs' })).toHaveTextContent('120');
  });

  it('appends and deduplicates older pages', async () => {
    vi.mocked(accountRequest).mockImplementation(async (path) => {
      if (path === 'spend') return { accountId: 'owner-1', entries: [entry('new', 'Newest')], nextCursor: '100:old' };
      if (path.startsWith('spend/totals')) return new Promise(() => {});
      if (path === 'spend?cursor=100%3Aold') return {
        accountId: 'owner-1',
        entries: [entry('new', 'Newest'), entry('old', 'Older')],
        nextCursor: null,
      };
      throw new Error(`Unexpected path: ${path}`);
    });
    render(<SpendPage />);

    expect(await screen.findByText('Newest')).toBeInTheDocument();
    expect(screen.queryByText(/loaded account record/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load older records' }));

    expect(await screen.findByText('Older')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older records' })).toBeNull();
    expect(within(screen.getByRole('table', { name: 'Ledger' })).getAllByRole('row')).toHaveLength(3);
  });

  it('deletes cloud rows through the account endpoint without changing local spend', async () => {
    vi.mocked(accountRequest).mockImplementation(async (path) => {
      if (path === 'spend') return { accountId: 'owner-1', entries: [entry('cloud', 'Cloud record')], nextCursor: null };
      if (path === 'spend/cloud') return {};
      throw new Error(`Unexpected path: ${path}`);
    });
    render(<SpendPage />);
    expect(await screen.findByText('Cloud record')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove entry' }));
    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('spend/cloud', expect.objectContaining({
      method: 'DELETE',
      headers: { 'X-Account-Id': 'owner-1' },
    })));
    expect(useSpendStore.getState().entries.map((item) => item.id)).toEqual(['guest']);
  });

  it('confirms an account-wide clear and leaves the browser ledger intact', async () => {
    vi.mocked(accountRequest).mockImplementation(async (path) => {
      if (path === 'spend') return { accountId: 'owner-1', entries: [entry('cloud', 'Cloud record')], nextCursor: null };
      if (path === 'spend/all') return {};
      throw new Error(`Unexpected path: ${path}`);
    });
    render(<SpendPage />);
    expect(await screen.findByText('Cloud record')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear ledger' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/every device/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear ledger' }));

    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('spend/all', expect.objectContaining({
      method: 'DELETE',
      headers: { 'X-Account-Id': 'owner-1' },
    })));
    expect(useSpendStore.getState().entries.map((item) => item.id)).toEqual(['guest']);
  });

  it('keeps the browser ledger usable when account status is unavailable without an owner', () => {
    useAccountStore.getState().applySession({ account: null, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
    useAccountStore.getState().unavailable();

    render(<SpendPage />);

    expect(screen.getByRole('alert')).toHaveTextContent("Showing this browser's separate spend ledger");
    expect(screen.getByText('Browser record')).toBeInTheDocument();
    expect(screen.queryByText(/can be selected above/)).toBeNull();
  });

  it('invalidates a pending clear confirmation when the same owner epoch changes', async () => {
    vi.mocked(accountRequest).mockImplementation(async (path) => {
      if (path === 'spend') return { accountId: 'owner-1', entries: [entry('cloud', 'Cloud record')], nextCursor: null };
      throw new Error(`Unexpected path: ${path}`);
    });
    render(<SpendPage />);
    expect(await screen.findByText('Cloud record')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear ledger' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    useAccountStore.setState((state) => ({ epoch: state.epoch + 1 }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(vi.mocked(accountRequest).mock.calls.some(([path, init]) => path === 'spend/all' && init?.method === 'DELETE')).toBe(false);
  });
});
