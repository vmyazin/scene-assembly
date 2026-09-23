'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';

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

/** Mirrors a loaded card's rows so the grid keeps its height while balances are read. */
function BalanceSkeleton() {
  const bar = 'rounded bg-[var(--foreground)]/10';
  return (
    <div aria-hidden="true" className="animate-pulse rounded-xl border border-[var(--border)] p-4 motion-reduce:animate-none">
      <div className={`${bar} h-4 w-24`} />
      <div className={`${bar} mt-3 h-7 w-32`} />
      <div className={`${bar} mt-2 h-3.5 w-48`} />
      <div className={`${bar} mt-4 h-3.5 w-28`} />
    </div>
  );
}

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

  return (
    <section className="glass-card p-4 md:p-5" aria-labelledby="provider-billing-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="provider-billing-heading" className="field-label">Provider balances</h2>
          <p className="field-hint mt-1">Live provider data, separate from the Scene Assembly spend ledger.</p>
        </div>
        <button
          type="button"
          className="btn-secondary grid size-10 place-items-center p-0"
          onClick={reload}
          disabled={loading}
          aria-label={loading ? 'Checking balances' : 'Refresh balances'}
          title="Refresh balances"
        >
          <RefreshCw size={16} aria-hidden="true" className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />
        </button>
      </div>
      {isLow && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-400/45 bg-amber-400/10 px-4 py-3 text-sm text-[var(--foreground)]">
          Kie is low: {lowKie.balance.toLocaleString()} credits (about {usd(lowKie.balance * KIE_USD_PER_CREDIT)}). A larger generation may need more credits.{' '}
          <a href={BILLING_URLS.kie} target="_blank" rel="noopener noreferrer" className="underline">Add credits at Kie</a>.
        </div>
      )}
      {loadError && <p role="status" className="field-hint mt-4">{loadError}</p>}
      {results.length === 0 && !loading && !loadError && (
        <p className="field-hint mt-4">No Kie, Runware, or Atlas connection found for this {source === 'account' ? 'account' : 'browser'}.{' '}<Link href="/" className="underline">Open the studio</Link> to connect one.</p>
      )}
      {loading && results.length === 0 && expected > 0 && (
        <div role="status" aria-label="Loading provider balances" className="mt-4 grid gap-3 md:grid-cols-3">
          {Array.from({ length: expected }, (_, index) => <BalanceSkeleton key={index} />)}
        </div>
      )}
      {results.length > 0 && (
        <dl className="mt-4 grid gap-3 md:grid-cols-3">
          {results.map(({ provider, snapshot, error }) => (
            <div key={provider} className="rounded-xl border border-[var(--border)] p-4">
              <dt className="field-label">{LABELS[provider]}</dt>
              {snapshot ? (
                <>
                  <dd className="mt-2 flex flex-wrap items-baseline gap-x-2">
                    <span className="display text-2xl">{snapshot.unit === 'credits' ? `${snapshot.balance.toLocaleString()} credits` : usd(snapshot.balance)}</span>
                    {/* Cash is the balance less bonus, so only a bonus says anything new — and only when there is one. */}
                    {snapshot.bonus !== undefined && snapshot.bonus > 0 && <span className="field-hint">incl. {usd(snapshot.bonus)} bonus</span>}
                  </dd>
                  <p className="field-hint mt-1">Available balance{snapshot.unit === 'credits' ? ` · about ${usd(snapshot.balance * KIE_USD_PER_CREDIT)}` : ''} · checked {new Date(snapshot.fetchedAt).toLocaleTimeString()}</p>
                  {snapshot.spentLast30Days !== undefined && <p className="field-hint mt-2">Provider reported last 30 days: {usd(snapshot.spentLast30Days)}{snapshot.requestsLast30Days !== undefined ? ` across ${snapshot.requestsLast30Days.toLocaleString()} requests` : ''}</p>}
                </>
              ) : <dd className="field-hint mt-2">{error || 'Balance unavailable.'}</dd>}
              <a href={BILLING_URLS[provider]} target="_blank" rel="noopener noreferrer" className="field-hint mt-3 inline-block underline">Manage billing ↗</a>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
