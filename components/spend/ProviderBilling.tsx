'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';

import ProviderLogo from '@/components/ProviderLogo';

import { accountRequest } from '@/lib/account/client';
import { type BillingProvider, type ProviderBillingSnapshot } from '@/lib/billing/provider-readout';
import { KIE_USD_PER_CREDIT } from '@/lib/spend/rates';
import { useAppStore } from '@/store/useAppStore';

type Result = { provider: BillingProvider; snapshot?: ProviderBillingSnapshot; error?: string };
const LABELS: Record<BillingProvider, string> = { kie: 'Kie.ai', runware: 'Runware', atlas: 'Atlas Cloud' };
const BILLING_URLS: Record<BillingProvider, string> = {
  kie: 'https://kie.ai/billing',
  runware: 'https://runware.ai/dashboard',
  atlas: 'https://www.atlascloud.ai/console/billing',
};
const KIE_LOW_CREDITS = 2_000;

function usd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

/** Mirrors a loaded column so the tile keeps its height while balances are read. */
function BalanceSkeleton() {
  const bar = 'rounded bg-[var(--foreground)]/10';
  return (
    <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
      <div className={`${bar} h-3.5 w-20`} />
      <div className={`${bar} mt-2 h-5 w-16`} />
      <div className={`${bar} mt-2 h-3 w-24`} />
    </div>
  );
}

const COLUMN = 'min-w-0 border-[var(--border)] max-sm:border-t max-sm:pt-2.5 max-sm:first:border-t-0 max-sm:first:pt-0 sm:border-l sm:px-3.5 sm:first:border-l-0 sm:first:pl-0';

export default function ProviderBilling({ source, ownerId, epoch }: { source: 'account' | 'browser'; ownerId: string | null; epoch: number }) {
  const kieKey = useAppStore(state => state.kieApiKey);
  const runwareKey = useAppStore(state => state.runwareApiKey);
  const atlasKey = useAppStore(state => state.atlasApiKey);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  // Loading is derived rather than set: the last response belongs to a different
  // request key, so nothing needs resetting inside the effect.
  const requestKey = `${source}:${ownerId}:${epoch}:${kieKey}:${runwareKey}:${atlasKey}:${refresh}`;
  const [settled, setSettled] = useState<{ key: string; results: Result[]; error: string | null } | null>(null);
  const idle = source === 'account' && !ownerId;
  const current = settled?.key === requestKey ? settled : null;
  const loading = !idle && !current;
  const results = current?.results ?? [];
  const loadError = current?.error ?? null;

  useEffect(() => {
    if (source === 'account' && !ownerId) return;
    let cancelled = false;
    const keys: Partial<Record<BillingProvider, string>> = { kie: kieKey, runware: runwareKey, atlas: atlasKey };
    const connected = (Object.entries(keys) as [BillingProvider, string][]).filter(([, key]) => Boolean(key));
    const load = async () => {
      try {
        let next: Result[];
        if (source === 'account') {
          const response = await accountRequest<{ results: Result[] }>('provider-billing');
          next = response.results.filter(result => result.provider in LABELS);
        } else {
          next = await Promise.all(connected.map(async ([provider, apiKey]): Promise<Result> => {
            try {
              const response = await fetch('/api/provider-billing', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, apiKey }), cache: 'no-store',
              });
              if (!response.ok) throw new Error('Billing unavailable');
              const data = await response.json() as { snapshot: ProviderBillingSnapshot };
              return { provider, snapshot: data.snapshot };
            } catch { return { provider, error: 'Could not read balance.' }; }
          }));
        }
        if (!cancelled) setSettled({ key: requestKey, results: next, error: null });
      } catch {
        if (!cancelled) setSettled({ key: requestKey, results: [], error: 'Saved provider billing is temporarily unavailable.' });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [source, ownerId, kieKey, runwareKey, atlasKey, requestKey]);

  // A browser knows which keys it holds; an account's connections live on the Worker.
  const expected = source === 'browser' ? [kieKey, runwareKey, atlasKey].filter(Boolean).length : 3;
  const lowKie = results.find(result => result.provider === 'kie')?.snapshot;
  const isLow = lowKie?.unit === 'credits' && lowKie.balance < KIE_LOW_CREDITS;

  const checkedAt = results.reduce((latest, result) => Math.max(latest, result.snapshot?.fetchedAt ?? 0), 0);
  const columns = loading && results.length === 0 ? expected : results.length;
  const gridColumns = columns >= 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';

  return (
    <section className="glass-card h-full px-4 pb-3.5 pt-3" aria-labelledby="provider-billing-heading">
      <div className="flex items-center justify-between gap-2.5">
        <h2 id="provider-billing-heading" className="field-label" title="Live provider data, separate from the Scene Assembly spend ledger.">Provider balances</h2>
        <div className="flex items-center gap-2">
          {checkedAt > 0 && <span className="field-hint">{new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
          <button
            type="button"
            className="btn-secondary size-8 place-items-center p-0"
            onClick={reload}
            disabled={loading}
            aria-label={loading ? 'Checking balances' : 'Refresh balances'}
            title="Refresh balances"
          >
            <RefreshCw size={14} aria-hidden="true" className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />
          </button>
        </div>
      </div>
      {/* The tile has no room for a banner, so the warning is spoken here and shown as the Kie column's Low state. */}
      {isLow && (
        <p role="alert" className="sr-only">
          Kie is low: {lowKie.balance.toLocaleString()} credits (about {usd(lowKie.balance * KIE_USD_PER_CREDIT)}). A larger generation may need more credits.
        </p>
      )}
      {loadError && <p role="status" className="field-hint mt-2.5">{loadError}</p>}
      {results.length === 0 && !loading && !loadError && (
        <p className="field-hint mt-2.5">No Kie, Runware, or Atlas connection found for this {source === 'account' ? 'account' : 'browser'}.{' '}<Link href="/" className="underline">Open the studio</Link> to connect one.</p>
      )}
      {loading && results.length === 0 && expected > 0 && (
        <div role="status" aria-label="Loading provider balances" className={`mt-2.5 grid gap-2.5 sm:gap-0 ${gridColumns}`}>
          {Array.from({ length: expected }, (_, index) => <div key={index} className={COLUMN}><BalanceSkeleton /></div>)}
        </div>
      )}
      {results.length > 0 && (
        <dl className={`mt-2.5 grid gap-2.5 sm:gap-0 ${gridColumns}`}>
          {results.map(({ provider, snapshot, error }) => {
            const low = provider === 'kie' && isLow;
            const credits = snapshot?.unit === 'credits';
            const manage = (
              <a href={BILLING_URLS[provider]} target="_blank" rel="noopener noreferrer" className={`underline ${low ? 'text-amber-300' : ''}`}>
                {low ? 'Add credits' : 'Manage'} ↗
              </a>
            );
            return (
              <div key={provider} className={COLUMN}>
                <dt className="flex items-center gap-1.5 text-[0.78125rem] text-[var(--foreground-muted)]">
                  <span className="grid size-[18px] flex-none place-items-center rounded-[5px] bg-[var(--foreground)]/[0.08]"><ProviderLogo provider={provider} size={12} /></span>
                  {LABELS[provider]}
                  {low && <span className="rounded-full bg-amber-400/10 px-1.5 text-[0.6875rem] font-medium text-amber-300 ring-1 ring-inset ring-amber-400/35">Low</span>}
                </dt>
                {snapshot ? (
                  <>
                    {/* Credits read in dollars first, at the published rate, so every column compares in one unit. */}
                    <dd className={`display mt-1.5 text-[1.1875rem] font-medium tabular-nums ${low ? 'text-amber-300' : ''}`} title={credits ? 'Approximate, at the published credit rate' : undefined}>
                      {usd(credits ? snapshot.balance * KIE_USD_PER_CREDIT : snapshot.balance)}
                    </dd>
                    <dd className="field-hint mt-1">
                      {credits && <><span>{snapshot.balance.toLocaleString()} credits</span> · </>}
                      {/* Cash is the balance less bonus, so only a bonus says anything new — and only when there is one. */}
                      {snapshot.bonus !== undefined && snapshot.bonus > 0 && <>incl. {usd(snapshot.bonus)} bonus · </>}
                      {snapshot.spentLast30Days !== undefined && <span title={snapshot.requestsLast30Days !== undefined ? `${snapshot.requestsLast30Days.toLocaleString()} requests, provider reported` : 'Provider reported'}>{usd(snapshot.spentLast30Days)} last 30 days · </span>}
                      {manage}
                    </dd>
                  </>
                ) : (
                  <>
                    <dd className="display mt-1.5 text-[1.1875rem] font-medium text-[var(--foreground-subtle)]">—</dd>
                    <dd className="field-hint mt-1"><span title={error || undefined}>Unavailable</span> · {manage}</dd>
                  </>
                )}
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
