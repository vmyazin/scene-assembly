'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Cloud, LogOut, WalletCards } from 'lucide-react';

import CloudAssetGrid from './CloudAssetGrid';
import CloudJobList from './CloudJobList';
import LibraryFilters, { type LibraryFilterId } from './LibraryFilters';
import AccountAvatar from './AccountAvatar';
import AccountConnections from './AccountConnections';
import AccountDeletion from './AccountDeletion';
import BrowserImportDialog from './BrowserImportDialog';
import { accountRequest } from '@/lib/account/client';
import { browserKeyCandidates } from '@/lib/account/key-import';
import { isImportableGalleryRecord } from '@/lib/account/import';
import { awaitingDecision, isActiveJob, needsAttention } from '@/lib/account/job-status';
import { formatAccountBytes as size, useAccountLibrary, type LibraryKind } from '@/lib/account/use-library';
import { useAccountSpendTotals } from '@/lib/account/use-spend-totals';
import { formatUsdTotal } from '@/lib/spend/format';
import type { CloudJobView } from '@/lib/account/contracts';
import type { AccountIdentity } from '@/store/useAccountStore';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { useGalleryStore } from '@/store/useGalleryStore';

function RailLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">{children}</span>
      {aside && <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">{aside}</span>}
    </div>
  );
}

function RailBlock({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 border-t border-[var(--border)] pt-4">{children}</div>;
}

/**
 * The two deep links into this console: `#jobs` from the queue card's count,
 * and `#asset-<id>` from a succeeded queue row (`libraryHashForAsset`).
 */
function readHash(): { jobs: boolean; assetId: string | null } {
  if (typeof window === 'undefined') return { jobs: false, assetId: null };
  const hash = window.location.hash;
  const match = /^#asset-(.+)$/.exec(hash);
  return { jobs: hash === '#jobs', assetId: match ? match[1] : null };
}

/**
 * The signed-in account console: a settings rail beside the cloud library.
 *
 * The library hook is mounted once, here, and its data handed down. Letting the
 * rail and the canvas each call `useAccountLibrary` would put two five-second
 * polls on the page and let the meter and the grid disagree about the same
 * account for up to five seconds at a time.
 */
export default function AccountConsole({
  account,
  localTest = false,
  busy,
  error,
  onSignOut,
  onManageKeys,
}: {
  account: AccountIdentity;
  localTest?: boolean;
  busy: boolean;
  error: string | null;
  onSignOut: () => void;
  /**
   * Opens the connections dialog. Lives in the parent, outside this
   * component's remount key, because `accountChanged()`/`refreshAccount()` —
   * fired by the dialog's own storage buttons — can bump that key and
   * remount this whole console. State owned here would be discarded along
   * with it, closing the dialog out from under the click that just used it.
   */
  onManageKeys: () => void;
}) {
  const ownerId = account.id;
  const router = useRouter();
  /**
   * Where the job queue card sends people. `#jobs` is its count, which has to
   * land on the jobs it counted or the count is a dead end; `#asset-<id>` is a
   * succeeded row, which points at one result rather than at the page.
   *
   * The initializer covers a full page load. The effect covers the rest, and it
   * is not redundant: arriving from the studio is a client-side navigation, and
   * Next writes that URL with `history.pushState` — which fires no `hashchange`
   * and lands after the first render, so a console that only read the hash in
   * its initializer showed the plain library every time the link was clicked
   * from inside the app. `hashchange` still has its own job: the reader may
   * already be standing on /account, and that navigation remounts nothing.
   */
  const [filter, setFilter] = useState<LibraryFilterId>(() => (readHash().jobs ? 'attention' : 'all'));
  const [highlightAssetId, setHighlightAssetId] = useState<string | null>(() => readHash().assetId);
  useEffect(() => {
    const read = () => {
      const { jobs, assetId } = readHash();
      if (jobs) { setFilter('attention'); return; }
      if (!assetId) return;
      // The asset lives in the grid, so a console left on the jobs tab has to
      // move back to it or the highlight would point at a panel that is not on
      // screen.
      setFilter('all');
      setHighlightAssetId(assetId);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Job-state filters cannot be an asset query, so the asset request stays on
  // `all` while the canvas swaps to the job list.
  const assetFilter: LibraryKind = filter === 'active' || filter === 'attention' ? 'all' : filter;
  const library = useAccountLibrary(ownerId, assetFilter);
  const { jobs, assets, storage, counts, loading } = library;
  const spend = useAccountSpendTotals(ownerId);

  const activeJobs = useMemo(() => jobs.filter(isActiveJob), [jobs]);
  /** Two numbers, because they answer different questions. The tab lists
   *  everything unresolved — a stopped job is still a row someone has to clear,
   *  and this is the only place it can be cleared from — while the pill counts
   *  only the rows where a decision changes something. Counting them together
   *  is how five real decisions wore a "Needs attention 11" badge. */
  const attentionJobs = useMemo(() => jobs.filter(needsAttention), [jobs]);
  const decisionCount = useMemo(() => attentionJobs.filter(awaitingDecision).length, [attentionJobs]);

  // Selected field by field on purpose: a selector returning a fresh object
  // gives `useSyncExternalStore` a new snapshot every render, which loops.
  const apiKey = useAppStore(state => state.apiKey);
  const cfToken = useAppStore(state => state.cfToken);
  const cfAccountId = useAppStore(state => state.cfAccountId);
  const kieApiKey = useAppStore(state => state.kieApiKey);
  const falApiKey = useAppStore(state => state.falApiKey);
  const runwareApiKey = useAppStore(state => state.runwareApiKey);
  const atlasApiKey = useAppStore(state => state.atlasApiKey);
  const piapiApiKey = useAppStore(state => state.piapiApiKey);
  const cometApiKey = useAppStore(state => state.cometApiKey);
  const records = useGalleryStore(state => state.records);
  // Both stores are hydrated here rather than inside the import panels: those
  // now render behind a disclosure that only opens when something is waiting,
  // so leaving hydration to them would mean the count that decides whether to
  // show the section could never rise above zero.
  useEffect(() => {
    if (!useAppStore.getState().hasHydrated) void useAppStore.persist.rehydrate();
    void useGalleryStore.getState().hydrate();
  }, []);
  const browserKeys = useMemo(
    () => browserKeyCandidates({ apiKey, cfToken, cfAccountId, kieApiKey, falApiKey, runwareApiKey, atlasApiKey, cometApiKey, piapiApiKey }).length,
    [apiKey, atlasApiKey, cfAccountId, cfToken, cometApiKey, piapiApiKey, falApiKey, kieApiKey, runwareApiKey]
  );
  const browserFiles = useMemo(() => records.filter(isImportableGalleryRecord), [records]);
  const browserBytes = browserFiles.reduce((total, record) => total + record.blob.size, 0);
  const pendingImports = browserKeys + browserFiles.length;

  async function jobAction(path: string, body?: unknown) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (ownerId !== useAccountStore.getState().session?.account?.id) throw new Error('Your account changed. Try again from the current library.');
      await accountRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Account-Id': ownerId }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (ownerId === useAccountStore.getState().session?.account?.id) library.refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Please try again.');
    } finally {
      setActionBusy(false);
    }
  }

  /**
   * One path off the list for both halves of what used to be two steps. A job
   * still awaiting a decision is dismissed with `remove`, so the Worker
   * releases its reservation and hides the row in a single batch; anything
   * already terminal is deleted. They belong in one loop because they share an
   * outcome — the row is gone — and differ only in which endpoint gets there.
   *
   * Sequential and sharing one busy window, because "Clear" hands over every
   * job at once: firing them in parallel would race the same account rows, and
   * routing them back through `jobAction` would drop all but the first to its
   * own re-entry guard. The owner is re-checked between requests for the same
   * reason the import loop does it — a session can change partway through a run
   * of calls. A failure still refreshes, so a partly cleared list shows what
   * actually remains rather than the rows it started with.
   */
  async function clearJobs(targets: CloudJobView[]) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      for (const job of targets) {
        if (ownerId !== useAccountStore.getState().session?.account?.id) throw new Error('Your account changed. Try again from the current library.');
        await (job.state === 'needs_attention'
          ? accountRequest(`jobs/${job.id}/dismiss`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Account-Id': ownerId }, body: JSON.stringify({ remove: true }) })
          : accountRequest(`jobs/${job.id}`, { method: 'DELETE', headers: { 'X-Account-Id': ownerId } }));
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Please try again.');
    } finally {
      if (ownerId === useAccountStore.getState().session?.account?.id) library.refresh();
      setActionBusy(false);
    }
  }

  const showingJobs = filter === 'active' || filter === 'attention';
  const visibleJobs = filter === 'active' ? activeJobs : attentionJobs;

  return (
    <div className="mt-8 grid items-start gap-0 overflow-hidden rounded-2xl border border-[var(--border-hover)] bg-[var(--background-elevated)] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside aria-label="Account settings" className="border-b border-[var(--border)] bg-[hsl(var(--tint-hue)_42%_8.8%/0.45)] p-5 lg:min-h-[40rem] lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5">
          <AccountAvatar name={account.name} picture={account.picture} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--foreground)]">{account.name}</p>
            <p className="break-all text-xs text-[var(--foreground-muted)]">{account.email}</p>
          </div>
        </div>
        <button type="button" disabled={busy} onClick={onSignOut} className="btn-secondary mt-3.5 flex w-full justify-center">
          <LogOut size={15} aria-hidden="true" />{busy ? 'Signing out…' : 'Sign out'}
        </button>
        {error && <p role="alert" className="mt-3 text-sm text-[var(--neon-pink)]">{error}</p>}

        <RailBlock>
          <RailLabel aside={storage ? `${Math.round((storage.usedBytes / storage.limitBytes) * 100)}%` : undefined}>Cloud storage</RailLabel>
          {storage ? (
            <>
              <div
                role="meter"
                aria-valuemin={0}
                aria-valuemax={storage.limitBytes}
                aria-valuenow={Math.min(storage.limitBytes, storage.usedBytes + storage.reservedBytes)}
                aria-valuetext={`${size(storage.usedBytes)} saved, ${size(storage.reservedBytes)} reserved`}
                aria-label="Cloud storage used and reserved"
                className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/10"
              >
                <span className="bg-[var(--neon-cyan)] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.min(100, (storage.usedBytes / storage.limitBytes) * 100)}%` }} />
                <span className="bg-violet-400/70 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.min(100, (storage.reservedBytes / storage.limitBytes) * 100)}%` }} />
              </div>
              <div className="mt-2 flex justify-between gap-2 text-xs">
                <span className="font-medium text-[var(--foreground)]">{size(storage.usedBytes)} saved</span>
                <span className="text-[var(--foreground-muted)]">1 GB included</span>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--foreground-subtle)]">
                {/* "Unfinished", not "active": this figure is the reservation
                    counter, which releases only on a terminal state, so it also
                    counts a job parked in needs_attention. The intake stopped
                    counting those as slots, and the tab beside this shows only
                    the running ones — two different numbers called "active" in
                    one panel is how a reader concludes the page is broken. */}
                {storage.activeJobs > 0
                  ? `${storage.activeJobs} unfinished ${storage.activeJobs === 1 ? 'job' : 'jobs'} · ${size(storage.reservedBytes)} reserved`
                  : `${size(storage.reservedBytes)} reserved for unfinished jobs`}
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs text-[var(--foreground-muted)]">Checking your storage…</p>
          )}
        </RailBlock>

        <RailBlock>
          <RailLabel aside={<Link href="/spend" className="hover:text-[var(--neon-cyan)]">View →</Link>}>Spend</RailLabel>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="display text-xl font-semibold text-[var(--foreground)]">
              {spend.totals ? formatUsdTotal(spend.totals.costUsd) : '—'}
            </span>
            <span className="text-xs text-[var(--foreground-muted)]">
              {spend.totals ? `${spend.totals.runs} run${spend.totals.runs === 1 ? '' : 's'}` : spend.error ? 'Unavailable' : 'Loading…'}
            </span>
          </div>
          <Link href="/spend" className="btn-secondary mt-2.5 flex w-full justify-center">
            <WalletCards size={15} aria-hidden="true" />View spend
          </Link>
        </RailBlock>

        <RailBlock>
          <AccountConnections onManage={onManageKeys} />
        </RailBlock>

        {/* Absent, not empty: an account with nothing staged on this device has
            no import decision to make, and a permanent "nothing here" line is
            one more thing to read past on every visit. */}
        {pendingImports > 0 && (
          <RailBlock>
            <RailLabel aside={String(pendingImports)}>Import from this browser</RailLabel>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--foreground-subtle)]">
              {browserKeys > 0 && `${browserKeys} provider ${browserKeys === 1 ? 'key' : 'keys'}`}
              {browserKeys > 0 && browserFiles.length > 0 && ' and '}
              {browserFiles.length > 0 && `${browserFiles.length} ${browserFiles.length === 1 ? 'file' : 'files'} (${size(browserBytes)})`}
              {' found on this device. Originals remain here.'}
            </p>
            {/* The picker needs far more room than 300px, so the rail keeps the
                summary and hands the choosing to a dialog. */}
            <button type="button" onClick={() => setImporting(true)} className="btn-secondary mt-2.5 flex w-full justify-center">
              {`Review ${pendingImports} item${pendingImports === 1 ? '' : 's'}`}
            </button>
          </RailBlock>
        )}

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <AccountDeletion ownerId={ownerId} variant="rail" />
        </div>

        <BrowserImportDialog
          open={importing}
          ownerId={ownerId}
          storage={storage}
          onClose={() => setImporting(false)}
          onImported={library.refresh}
        />
      </aside>

      <div className="min-w-0 p-5 sm:p-6">
        <h2 className="display text-2xl font-semibold tracking-tight text-[var(--foreground)]">Cloud library</h2>
        <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">Everything saved to your private cloud account, newest first.</p>

        <LibraryFilters
          counts={counts}
          attentionCount={decisionCount}
          stoppedCount={attentionJobs.length - decisionCount}
          activeCount={activeJobs.length}
          active={filter}
          onSelect={setFilter}
        />

        {localTest && (
          <button
            type="button"
            disabled={actionBusy}
            className="btn-secondary mt-4 px-2.5 py-1 text-xs"
            onClick={() => void jobAction('jobs', { token: crypto.randomUUID(), request: { provider: 'local-test', modelId: 'local-test', mediaType: 'image', inputMode: 'text', prompt: 'Local background test', values: {}, referenceIds: [] } })}
          >
            Run local background test
          </button>
        )}

        <div id="jobs" className="mt-4 scroll-mt-24">
          {showingJobs ? (
            visibleJobs.length > 0 ? (
              <>
              {/* Says why the tab holds more rows than its badge counts.
                  Without it the pill reads as a miscount rather than as the
                  distinction it is: decisions above, records to clear below. */}
              {filter === 'attention' && decisionCount > 0 && attentionJobs.length > decisionCount && (
                <p className="mb-3 text-xs text-[var(--foreground-muted)]">
                  {decisionCount} waiting on you · {attentionJobs.length - decisionCount} stopped {attentionJobs.length - decisionCount === 1 ? 'record' : 'records'} you can clear.
                </p>
              )}
              <CloudJobList
                jobs={visibleJobs}
                limit={20}
                busy={actionBusy}
                onResume={id => void jobAction(`jobs/${id}/resume`)}
                onCancel={id => void jobAction(`jobs/${id}/cancel`)}
                onDismiss={id => { const job = jobs.find(entry => entry.id === id); if (job) void clearJobs([job]); }}
                onClear={targets => void clearJobs(targets)}
              />
              </>
            ) : (
              <p className="py-8 text-center text-sm text-[var(--foreground-muted)]">Nothing here right now.</p>
            )
          ) : loading ? (
            <p role="status" className="py-8 text-center text-sm text-[var(--foreground-muted)]">Loading cloud assets…</p>
          ) : assets.length === 0 && !library.cursor ? (
            /* The mock never drew an empty library, so this state is designed
               rather than inherited: a single grey line in a canvas this wide
               reads as a broken page. No studio link — the header already
               carries one, and repeating it here was cut in review. */
            <div className="flex flex-col items-center rounded-xl border border-[var(--border)] px-6 py-14 text-center">
              <span className="rounded-xl border border-cyan-400/25 bg-gradient-to-br from-cyan-400/15 to-violet-400/15 p-3 text-cyan-300">
                <Cloud size={22} aria-hidden="true" />
              </span>
              <p className="mt-4 text-base font-semibold text-[var(--foreground)]">Nothing saved to the cloud yet</p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--foreground-muted)]">
                Generations you run while signed in are saved here automatically and stay available on every device you sign in from.
                {browserFiles.length > 0 && ' Work already on this device can be imported from the panel on the left.'}
              </p>
            </div>
          ) : (
            /* Same follow-through as the studio header's library overlay: a clip
               placed from here lands on a timeline the viewer cannot see, so the
               console has to move to the editor with it — a toast alone reads as
               a button that filed the clip somewhere unnamed. The grid fires this
               only after the placement succeeds, so a failed add stays on the
               account page with its error toast. */
            <CloudAssetGrid assets={assets} ownerId={ownerId} columns={4} highlightAssetId={highlightAssetId} onAddedToTimeline={() => router.push('/timeline')} onChanged={library.refresh} />
          )}
        </div>

        {(library.cursor || library.nextCursor) && !showingJobs && (
          <div className="mt-4 flex justify-between gap-2">
            {library.cursor && <button type="button" disabled={loading} className="btn-secondary text-sm" onClick={() => library.page(null)}>Latest assets</button>}
            {library.nextCursor && <button type="button" disabled={loading} className="btn-secondary text-sm" onClick={() => library.page(library.nextCursor)}>Older assets</button>}
          </div>
        )}

        {(actionError || library.error) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="text-sm text-red-300">{actionError || library.error}</p>
            {library.error && <button type="button" disabled={loading} className="btn-secondary px-2 py-1 text-xs" onClick={library.refresh}>Try again</button>}
          </div>
        )}
      </div>
    </div>
  );
}
