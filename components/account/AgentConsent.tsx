'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AccountPageShell from './AccountPageShell';
import { AccountSurface } from './AccountSurface';
import { accountRequest } from '@/lib/account/client';
import { RouteError } from '@/lib/providers/route-error';
import type { AgentAuthorizationView } from '@/lib/account/contracts';
import { formatUsdTotal } from '@/lib/spend/format';
import { useAccountStore } from '@/store/useAccountStore';

const list = new Intl.ListFormat('en', { type: 'conjunction' });

/**
 * The one decision an agent connection needs from a person: who is asking,
 * what it may spend, and whether it may run unpriced models or delete files.
 * The Worker parked the request and bound it to this browser; approving here
 * records the decision, and the finish link completes it in the same browser.
 *
 * The POST's `redirectTo` carries a one-time secret the Worker minted for this
 * decision (`…/oauth/finish?request=<id>&t=<secret>`); it cannot be rebuilt
 * from the request id, so this component navigates only to the string the
 * server returned and never constructs a finish URL itself.
 */
export default function AgentConsent({ requestId, navigate = url => window.location.assign(url) }: { requestId: string | null; navigate?: (url: string) => void }) {
  const router = useRouter();
  const session = useAccountStore(state => state.session);
  const status = useAccountStore(state => state.status);
  const accountId = session?.account?.id;
  const [view, setView] = useState<AgentAuthorizationView | null>(null);
  const [problem, setProblem] = useState<string | null>(requestId ? null : 'This link is missing its connection request. Start connecting again from your agent.');
  const [budget, setBudget] = useState('');
  const [allowUnknownCost, setAllowUnknownCost] = useState(false);
  const [allowDelete, setAllowDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'ready' && !accountId && requestId) router.replace(`/sign-in?returnTo=${encodeURIComponent(`/connect-agent?request=${requestId}`)}`);
  }, [accountId, requestId, router, status]);

  useEffect(() => {
    if (!accountId || !requestId) return;
    const controller = new AbortController();
    accountRequest<{ authorization: AgentAuthorizationView }>(`agent-authorizations/${requestId}`, { signal: controller.signal, headers: { 'X-Account-Id': accountId } })
      .then(({ authorization }) => {
        setView(authorization);
        setBudget(String(authorization.defaults.budgetUsd));
        setAllowUnknownCost(authorization.defaults.allowUnknownCost);
        setAllowDelete(authorization.defaults.allowDelete);
      })
      .catch(reason => { if (!controller.signal.aborted) setProblem(reason instanceof Error ? reason.message : 'This connection request could not be loaded.'); });
    return () => controller.abort();
  }, [accountId, requestId]);

  async function decide(decision: 'approve' | 'deny') {
    if (!view || !accountId || !requestId) return;
    const budgetUsd = Number(budget);
    if (decision === 'approve' && (!Number.isFinite(budgetUsd) || budgetUsd < view.limits.minUsd || budgetUsd > view.limits.maxUsd)) {
      setProblem(`Set a limit between ${formatUsdTotal(view.limits.minUsd)} and ${formatUsdTotal(view.limits.maxUsd)}.`);
      return;
    }
    // Lock both buttons for the rest of this component's life: a lost response
    // cannot be retried (the server answers a second decision with 409), so
    // once a decision is on the wire there is no state where re-enabling them
    // is safe — success keeps them locked because we are about to navigate
    // away, and a 409 keeps them locked because trying again only 409s again.
    setBusy(true);
    setProblem(null);
    try {
      const { redirectTo } = await accountRequest<{ redirectTo: string }>(`agent-authorizations/${requestId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Account-Id': accountId },
        body: JSON.stringify(decision === 'approve' ? { decision, budgetUsd, allowUnknownCost, allowDelete } : { decision }),
      });
      navigate(redirectTo);
    } catch (reason) {
      if (reason instanceof RouteError && reason.status === 409) {
        setProblem('This request was already answered. Start connecting again from your agent.');
        return;
      }
      setProblem(reason instanceof Error ? reason.message : 'Please try again.');
      setBusy(false);
    }
  }

  const affects = view?.unknownPriceProviders.map(entry => entry.scope === 'all' ? entry.label : `some ${entry.label} models`) ?? [];

  return (
    <AccountPageShell narrow title="Connect an agent" description="An AI agent is asking to use your Scene Assembly account.">
      <AccountSurface label="Agent access" className="mt-8">
        {!view ? (
          problem ? <p role="alert" className="text-sm leading-relaxed text-[var(--neon-pink)]">{problem}</p>
            : <p role="status" className="text-sm text-[var(--foreground-muted)]">Loading the request…</p>
        ) : (
          /* noValidate: the budget field keeps min/max as spinner hints, but the
             range check below owns the message — native constraint validation
             would otherwise swallow the submit event and block our handler
             from ever running, showing nothing at all. */
          <form noValidate onSubmit={event => { event.preventDefault(); void decide('approve'); }}>
            <p className="text-sm leading-relaxed text-[var(--foreground)]"><strong className="font-medium">{view.clientName}</strong> wants to generate images and video with your account.</p>
            <p className="mt-2 text-sm text-[var(--foreground-muted)]">
              {view.clientDomain ? `Identity verified for ${view.clientDomain}.` : 'Unverified: this is the name the agent gave itself.'}{' '}
              It will return to {view.redirectHost}{view.redirectIsLoopback ? ', an app on this computer' : ''}.
            </p>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[var(--foreground-muted)]">
              <li>Start image and video jobs with the provider keys connected to this account</li>
              <li>See your jobs, library and spend</li>
              <li>It cannot see or change your provider keys</li>
            </ul>
            <label htmlFor="agent-budget" className="field-label mt-6 block">Spend limit per 24 hours</label>
            <p className="field-hint">In US dollars. Jobs that would go over it are refused.</p>
            <input id="agent-budget" type="number" inputMode="decimal" min={view.limits.minUsd} max={view.limits.maxUsd} step="0.5" value={budget} onChange={event => setBudget(event.target.value)} className="mt-2 w-full" />
            <label htmlFor="agent-unknown" className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--background-elevated)]/60 p-3">
              <span>
                <span className="block text-sm font-medium text-[var(--foreground)]">Allow models without a published price</span>
                <span className="mt-1 block text-xs text-[var(--foreground-muted)]">These don’t count toward the limit unless the provider reports what they cost.</span>
                {affects.length > 0 && <span className="mt-1 block text-xs text-[var(--foreground-muted)]">Affects: {list.format(affects)}.</span>}
              </span>
              <input id="agent-unknown" type="checkbox" checked={allowUnknownCost} onChange={event => setAllowUnknownCost(event.target.checked)} className="h-4 w-4 accent-[var(--neon-cyan)]" />
            </label>
            <label htmlFor="agent-delete" className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--background-elevated)]/60 p-3">
              <span className="block text-sm font-medium text-[var(--foreground)]">Allow deleting files from your library</span>
              <input id="agent-delete" type="checkbox" checked={allowDelete} onChange={event => setAllowDelete(event.target.checked)} className="h-4 w-4 accent-[var(--neon-cyan)]" />
            </label>
            {problem && <p role="alert" className="mt-4 text-sm leading-relaxed text-[var(--neon-pink)]">{problem}</p>}
            <div className="mt-6 flex gap-3">
              <button type="submit" disabled={busy} className="btn-primary flex flex-1 justify-center">{busy ? 'Connecting…' : 'Approve'}</button>
              <button type="button" disabled={busy} onClick={() => void decide('deny')} className="btn-secondary flex flex-1 justify-center">Deny</button>
            </div>
          </form>
        )}
      </AccountSurface>
    </AccountPageShell>
  );
}
