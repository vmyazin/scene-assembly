// components/SiteFooterControls.tsx
'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useAccountSpendTotals } from '@/lib/account/use-spend-totals';
import { formatUsdTotal } from '@/lib/spend/format';
import { totals } from '@/lib/spend/rollup';
import { useSpendStore } from '@/store/useSpendStore';
import { CircleDollarSign, CircleUserRound, Plug, Volume2, VolumeX } from 'lucide-react';

import { setUiSoundsEnabled } from '@/lib/notify/chime';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';

/**
 * The two parts of the footer that depend on browser state, split out so the
 * rest of `SiteFooter` can stay a server component and reach the crawler as
 * HTML. They render on the server too — neither store touches `window` during
 * render, and `useAppStore` persists with `skipHydration`, so the first paint
 * matches the markup.
 */

function AccountSpendValue({ ownerId }: { ownerId: string }) {
  const spend = useAccountSpendTotals(ownerId);
  if (spend.totals?.costUsd === 0) return null;
  return <span title={spend.error ?? 'All-time account spend'}>{spend.totals ? formatUsdTotal(spend.totals.costUsd) : '—'}</span>;
}

function BrowserSpendValue() {
  const entries = useSpendStore(state => state.entries);
  const hydrated = useSpendStore(state => state.hasHydrated);
  useEffect(() => {
    if (!useSpendStore.getState().hasHydrated) void useSpendStore.persist.rehydrate();
  }, []);
  const costUsd = totals(entries).costUsd;
  if (hydrated && costUsd === 0) return null;
  return <span title="All-time browser spend">{hydrated ? formatUsdTotal(costUsd) : '—'}</span>;
}

export function FooterLinks() {
  /**
   * The session resolves a moment after paint, so the footer waits for a
   * definite answer before offering to sign anyone in: until then the row reads
   * Account and points at /account, which sends a signed-out visitor on to
   * sign-in anyway. Nobody sees a broken link, and nobody already signed in
   * watches the row flip out from under them.
   */
  const account = useAccountStore(s => s.session?.account);
  const signedOut = useAccountStore((s) => s.status === 'ready' && !s.session?.account);

  return (
    <ul className="rounded-xl border border-[var(--border)] bg-[var(--background-glass)] px-5 py-4 space-y-2 text-[0.8125rem] font-bold">
      <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Link
          href="/spend"
          className="inline-flex max-w-full items-center gap-2 text-[var(--neon-cyan)] hover:text-[var(--neon-purple)] transition-colors"
        >
          <CircleDollarSign size={15} aria-hidden="true" />
          Spend
          {account ? <AccountSpendValue ownerId={account.id} /> : signedOut ? <BrowserSpendValue /> : <span>—</span>}
        </Link>
        {/* An agent handed only the site URL reads the anchor text and href, so
            both say what this is. The Markdown twin is advertised from <head>,
            the Link header and llms.txt. */}
        <Link
          href="/docs/mcp"
          title="Connect an AI agent to Scene Assembly over MCP"
          className="inline-flex items-center gap-1.5 font-normal text-[var(--foreground-muted)] hover:text-[var(--neon-purple)] transition-colors"
        >
          <Plug className="shrink-0" size={13} aria-hidden="true" />
          MCP docs
        </Link>
      </li>
      <li>
        <Link
          href={signedOut ? '/sign-in' : '/account'}
          className="inline-flex max-w-full items-center gap-2 text-[var(--neon-cyan)] hover:text-[var(--neon-purple)] transition-colors"
        >
          <CircleUserRound className="shrink-0" size={15} aria-hidden="true" />
          <span className="min-w-0">
            {signedOut ? 'Sign in' : 'Account'}
            {account?.email && <span className="ml-2 font-normal text-[var(--foreground-muted)] [overflow-wrap:anywhere]">{' '}{account.email}</span>}
          </span>
        </Link>
      </li>
    </ul>
  );
}

/**
 * A studio preference rather than an account one, so it lives with the page
 * whose sounds it governs. The footer specifically: it is the only place
 * reachable without signing in AND at every width — the header's toggle is
 * `sm:`-gated and the command palette needs a keyboard, which between them left
 * a guest on a phone with no way to silence the studio.
 */
export function FooterSoundToggle() {
  const uiSoundsEnabled = useAppStore((s) => s.uiSoundsEnabled);

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]">
      <input
        type="checkbox"
        checked={uiSoundsEnabled}
        onChange={(event) => setUiSoundsEnabled(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--neon-cyan)]"
      />
      {/* Follows the state, the way the header's button already does. */}
      {uiSoundsEnabled ? <Volume2 size={13} aria-hidden="true" /> : <VolumeX size={13} aria-hidden="true" />}
      Interface sounds
    </label>
  );
}
