'use client';

import { useEffect, useRef } from 'react';

import SpendReport from '@/components/spend/SpendReport';
import { useAccountSpend } from '@/lib/account/use-spend';
import { useAccountSpendTotals } from '@/lib/account/use-spend-totals';
import { rangeStart, type SpendRange } from '@/lib/spend/rollup';

export default function AccountSpend({ ownerId, range, now, onClearRequest, onEmptyChange }: {
  ownerId: string;
  range: SpendRange;
  now: number;
  onClearRequest: (clear: () => Promise<void>) => void;
  /** Reports whether the account has any records at all, so the page can hide range controls that have nothing to filter. */
  onEmptyChange?: (empty: boolean) => void;
}) {
  const spend = useAccountSpend(ownerId);
  // The summary tiles come from the Worker, which totals the whole range in one
  // request; the rows below still page in fifty at a time.
  const summary = useAccountSpendTotals(ownerId, rangeStart(range, now));
  const refreshSummary = summary.refresh;
  const empty = spend.entries.length === 0;
  useEffect(() => { onEmptyChange?.(empty); }, [empty, onEmptyChange]);

  // A background poll that brings in a new run changes the newest row; re-total
  // then, but not on the first page landing, which the totals read already raced.
  const newest = spend.entries[0]?.id;
  const seenNewest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (seenNewest.current !== undefined && newest !== seenNewest.current) refreshSummary();
    seenNewest.current = newest;
  }, [newest, refreshSummary]);

  return (
    <SpendReport
      source="account"
      entries={spend.entries}
      // With every row loaded the local sum is already exact, so it stands in
      // until (or if) the Worker's figure is unavailable. With rows still
      // unloaded, a local sum would be the under-count this replaces.
      summaryTotals={summary.totals ?? (spend.hasOlder ? null : undefined)}
      range={range}
      now={now}
      loading={spend.loading}
      loadingOlder={spend.loadingOlder}
      error={spend.error}
      hasOlder={spend.hasOlder}
      onRetry={() => { void spend.refresh(); refreshSummary(); }}
      onLoadOlder={() => void spend.loadOlder()}
      onRemove={async (id) => { await spend.remove(id); refreshSummary(); }}
      onClearRequest={() => onClearRequest(async () => { await spend.clear(); refreshSummary(); })}
    />
  );
}
