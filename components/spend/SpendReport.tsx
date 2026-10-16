'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import SpendBreakdown from '@/components/spend/SpendBreakdown';
import SpendDailyChart from '@/components/spend/SpendDailyChart';
import SpendEmptyPreview from '@/components/spend/SpendEmptyPreview';
import SpendLedger from '@/components/spend/SpendLedger';
import SpendOverview from '@/components/spend/SpendOverview';
import { providerLabel, type SpendEntry, type SpendProvider } from '@/lib/spend/ledger';
import { byDay, byModel, byProvider, inRange, toCsv, totals, type SpendRange, type SpendTotals } from '@/lib/spend/rollup';
import { saveBlobAs } from '@/lib/save-file';

interface SpendReportProps {
  source: 'account' | 'browser';
  entries: SpendEntry[];
  /** Range totals computed elsewhere; null while pending. Omitted, the summary sums `entries`. */
  summaryTotals?: SpendTotals | null;
  /** All-time account total from the same endpoint as the footer, independent of the report range. */
  allTimeTotals?: SpendTotals | null;
  allTimeError?: string | null;
  onRetryAllTime?: () => void;
  range: SpendRange;
  onRangeChange: (range: SpendRange) => void;
  /** The provider balances tile; it joins the overview grid once anything is recorded. */
  balances?: ReactNode;
  now: number;
  loading?: boolean;
  loadingOlder?: boolean;
  error?: string | null;
  hasOlder?: boolean;
  onRetry?: () => void;
  onLoadOlder?: () => void;
  onRemove: (id: string) => void | Promise<void>;
  onClearRequest: () => void;
}

export default function SpendReport({
  source,
  entries,
  summaryTotals,
  allTimeTotals,
  allTimeError,
  onRetryAllTime,
  range,
  onRangeChange,
  balances,
  now,
  loading = false,
  loadingOlder = false,
  error,
  hasOlder = false,
  onRetry,
  onLoadOlder,
  onRemove,
  onClearRequest,
}: SpendReportProps) {
  const [providerFilter, setProviderFilter] = useState<SpendProvider | 'all'>('all');
  const scoped = useMemo(() => inRange(entries, range, now), [entries, range, now]);
  const shown = providerFilter === 'all' ? scoped : scoped.filter((entry) => entry.provider === providerFilter);
  const providersPresent = [...new Set(scoped.map((entry) => entry.provider))];
  const cloud = source === 'account';

  const exportCsv = () => {
    const blob = new Blob([toCsv(shown)], { type: 'text/csv' });
    saveBlobAs(blob, `scene-assembly-spend-${cloud ? 'cloud' : 'browser'}-${range}.csv`);
  };

  const lifetime = allTimeTotals === undefined ? (loading ? null : totals(entries)) : allTimeTotals;

  return (
    <>
      {error && (
        <div role="alert" className="glass-card p-4 text-sm">
          <p className="text-[var(--foreground)]">{error}</p>
          {onRetry && <button type="button" onClick={onRetry} className="btn-secondary mt-3">Try again</button>}
        </div>
      )}

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-16"><div className="loading-spinner" /></div>
      ) : entries.length === 0 ? (
        <>
          {/* Nothing to total or filter yet, so the balances stand alone and the range control stays hidden. */}
          {balances}
          <EmptyNotice cloud={cloud} message="Nothing recorded yet." hasOlder={hasOlder} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder} />
          <SpendEmptyPreview />
        </>
      ) : (
        <>
          <SpendOverview
            totals={summaryTotals === undefined ? totals(scoped) : summaryTotals}
            allTime={lifetime}
            allTimeError={allTimeError}
            onRetryAllTime={onRetryAllTime}
            range={range}
            onRangeChange={onRangeChange}
            balances={balances}
          />
          {scoped.length === 0 ? (
            <EmptyNotice cloud={cloud} message="Nothing recorded yet for this range." hasOlder={hasOlder} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder} />
          ) : (
            <>
              <SpendDailyChart days={byDay(scoped, range, now)} />
              <div className="grid gap-4 md:grid-cols-2">
                <SpendBreakdown title="By provider" rows={byProvider(scoped)} />
                <SpendBreakdown title="By model" rows={byModel(scoped)} />
              </div>
              <section className="glass-card p-3.5 md:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="field-label">Ledger</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="field-hint" htmlFor={`spend-provider-filter-${source}`}>Provider</label>
                    <select
                      id={`spend-provider-filter-${source}`}
                      value={providerFilter}
                      onChange={(event) => setProviderFilter(event.target.value as SpendProvider | 'all')}
                    >
                      <option value="all">All</option>
                      {providersPresent.map((provider) => (
                        <option key={provider} value={provider}>{providerLabel(provider)}</option>
                      ))}
                    </select>
                    <button type="button" onClick={exportCsv} className="btn-secondary">Export CSV</button>
                    <button type="button" onClick={onClearRequest} className="btn-secondary">Clear ledger</button>
                  </div>
                </div>
                <SpendLedger entries={shown} onRemove={onRemove} />
                {cloud && hasOlder && onLoadOlder && (
                  <div className="mt-4 flex justify-center border-t border-[var(--border)] pt-4">
                    <button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="btn-secondary">
                      {loadingOlder ? 'Loading…' : 'Load older records'}
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      <p className="field-hint text-center">
        {cloud
          ? 'Your spend is available on any computer or phone you sign in to.'
          : 'Stored in this browser only. Clearing site data clears the ledger. Sign in to access your spend on any computer or phone you use.'}
      </p>
    </>
  );
}

function EmptyNotice({ cloud, message, hasOlder, loadingOlder, onLoadOlder }: {
  cloud: boolean;
  message: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder?: () => void;
}) {
  return (
    <section className="glass-card p-6 text-center">
      <p className="text-[var(--foreground)]">{message}</p>
      <p className="field-hint mt-2">
        {cloud
          ? 'Finished and failed account runs can appear here when provider billing information is available. A failed or interrupted save may still be billed by the provider.'
          : 'Every finished image, video, and helper task is filed here with its cost. A provider may still bill an accepted run if saving or delivery later fails.'}
      </p>
      {!cloud && <Link href="/" className="btn-primary mt-4">Open the studio</Link>}
      {cloud && hasOlder && onLoadOlder && (
        <button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="btn-secondary mt-4">
          {loadingOlder ? 'Loading…' : 'Load older records'}
        </button>
      )}
    </section>
  );
}
