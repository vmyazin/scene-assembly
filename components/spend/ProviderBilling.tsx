'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

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

export default function ProviderBilling({ source, ownerId, epoch }: { source: 'account' | 'browser'; ownerId: string | null; epoch: number }) {
  const kieKey = useAppStore(state => state.kieApiKey);
  const runwareKey = useAppStore(state => state.runwareApiKey);
  const atlasKey = useAppStore(state => state.atlasApiKey);
  const [results, setResults] = useState<Result[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef(0);
  const reload = useCallback(() => setRefresh(value => value + 1), []);

  useEffect(() => {
    const id = ++requestId.current;
    const keys: Partial<Record<BillingProvider, string>> = { kie: kieKey, runware: runwareKey, atlas: atlasKey };
    const connected = (Object.entries(keys) as [BillingProvider, string][]).filter(([, key]) => Boolean(key));
    setLoading(true);
    setResults([]);
    setLoadError(null);
    const load = async () => {
      try {
        let next: Result[];
        if (source === 'account') {
          if (!ownerId) return;
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
        if (requestId.current === id) setResults(next);
      } catch {
        if (requestId.current === id) setLoadError('Saved provider billing is temporarily unavailable.');
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    };
    void load();
    return () => { requestId.current += 1; };
  }, [source, ownerId, epoch, kieKey, runwareKey, atlasKey, refresh]);

  const lowKie = results.find(result => result.provider === 'kie')?.snapshot;
  const isLow = lowKie?.unit === 'credits' && lowKie.balance < KIE_LOW_CREDITS;

  return (
    <section className="glass-card p-4 md:p-5" aria-labelledby="provider-billing-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="provider-billing-heading" className="field-label">Provider balances</h2>
          <p className="field-hint mt-1">Live provider data, separate from the Scene Assembly spend ledger.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={reload} disabled={loading}>{loading ? 'Checking…' : 'Refresh balances'}</button>
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
      {results.length > 0 && (
        <dl className="mt-4 grid gap-3 md:grid-cols-3">
          {results.map(({ provider, snapshot, error }) => (
            <div key={provider} className="rounded-xl border border-[var(--border)] p-4">
              <dt className="field-label">{LABELS[provider]}</dt>
              {snapshot ? (
                <>
                  <dd className="display mt-2 text-2xl">{snapshot.unit === 'credits' ? `${snapshot.balance.toLocaleString()} credits` : usd(snapshot.balance)}</dd>
                  <p className="field-hint mt-1">Available balance{snapshot.unit === 'credits' ? ` · about ${usd(snapshot.balance * KIE_USD_PER_CREDIT)}` : ''} · checked {new Date(snapshot.fetchedAt).toLocaleTimeString()}</p>
                  {snapshot.cash !== undefined && snapshot.bonus !== undefined && <p className="field-hint mt-2">{usd(snapshot.cash)} cash · {usd(snapshot.bonus)} bonus</p>}
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
