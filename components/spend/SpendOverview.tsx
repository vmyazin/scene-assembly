import type { ReactNode } from 'react';

import SegmentedToggleGroup from '@/components/SegmentedToggleGroup';
import { formatUsdTotal } from '@/lib/spend/format';
import { SPEND_RANGES, type SpendRange, type SpendTotals } from '@/lib/spend/rollup';

interface SpendOverviewProps {
  /** Range totals; null while a total computed elsewhere is still on its way. */
  totals: SpendTotals | null;
  /** All-time totals, independent of the range; null while pending. */
  allTime: SpendTotals | null;
  allTimeError?: string | null;
  onRetryAllTime?: () => void;
  range: SpendRange;
  onRangeChange: (range: SpendRange) => void;
  /** The provider balances tile, which fills the grid's lower-right cell. */
  balances?: ReactNode;
}

function runsLabel(count: number): string {
  return `${count} run${count === 1 ? '' : 's'}`;
}

/**
 * The top of /spend as one bento grid: the range total (with how much of it is
 * exact) on the left, runs and the all-time total beside it, and provider
 * balances underneath. One grid instead of five stacked cards, so the chart
 * and ledger start well above the fold.
 */
export default function SpendOverview({ totals, allTime, allTimeError, onRetryAllTime, range, onRangeChange, balances }: SpendOverviewProps) {
  const rangeLabel = SPEND_RANGES.find((option) => option.value === range)?.label ?? '';
  const exactShare = totals && totals.costUsd > 0 ? (totals.exactUsd / totals.costUsd) * 100 : 0;
  const totalHint = !totals
    ? 'Totalling…'
    : [`${Math.round(exactShare)}% exact`, totals.unknownRuns > 0 ? `${runsLabel(totals.unknownRuns)} unpriced` : 'every run priced'].join(' · ');

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-[1.6fr_1fr_1fr]">
      <section aria-label="Summary" aria-busy={!totals} className="glass-card col-span-2 flex flex-col p-4 md:col-span-1 md:row-span-2 md:px-[1.125rem]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="field-label">Total</h2>
          <SegmentedToggleGroup
            label="Range"
            size="compact"
            options={SPEND_RANGES}
            value={range}
            onChange={(value) => onRangeChange(value as SpendRange)}
          />
        </div>
        <p className="display mt-[1.125rem] text-[2.875rem] font-medium tabular-nums">{totals ? formatUsdTotal(totals.costUsd) : '—'}</p>
        <p className="field-hint mt-1.5">{totalHint}</p>
        {totals && (
          <div className="mt-auto pt-6">
            {/* Unpriced runs have no dollar width, so the bar splits only what is priced; their count is in the hint above. */}
            <div className="flex h-2 overflow-hidden rounded-full bg-[var(--foreground)]/[0.06]" aria-hidden="true">
              <div className="bg-[var(--neon-cyan)]" style={{ width: `${exactShare}%` }} />
              <div className="bg-[var(--neon-cyan)]/30" style={{ width: totals.costUsd > 0 ? `${100 - exactShare}%` : 0 }} />
            </div>
            <dl className="mt-2.5 flex gap-x-6">
              <div>
                <dt className="field-hint flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[var(--neon-cyan)]" aria-hidden="true" />Exact</dt>
                <dd className="display text-[0.9375rem] font-medium tabular-nums">{formatUsdTotal(totals.exactUsd)}</dd>
              </div>
              <div>
                <dt className="field-hint flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[var(--neon-cyan)]/30" aria-hidden="true" />Estimated</dt>
                <dd className="display text-[0.9375rem] font-medium tabular-nums">{formatUsdTotal(totals.estimatedUsd)}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      <section aria-label="Runs" className="glass-card px-4 py-3.5">
        <h2 className="field-hint">Runs</h2>
        <p className="display mt-1.5 text-2xl font-medium tabular-nums">{totals ? totals.runs : '—'}</p>
        <p className="field-hint mt-1">{rangeLabel.toLowerCase()}</p>
      </section>

      <section aria-label="All-time spend" className="glass-card px-4 py-3.5">
        <h2 className="field-hint">All time</h2>
        <p className="display mt-1.5 text-2xl font-medium tabular-nums">{allTime ? formatUsdTotal(allTime.costUsd) : '—'}</p>
        <p className="field-hint mt-1">
          {allTimeError ? 'Total spend is temporarily unavailable.' : !allTime ? 'Totalling…' : allTime.unknownRuns > 0 ? `${runsLabel(allTime.unknownRuns)} unpriced` : 'every run priced'}
        </p>
        {allTimeError && onRetryAllTime && <button type="button" onClick={onRetryAllTime} className="field-hint mt-1 underline">Retry total</button>}
      </section>

      {balances && <div className="col-span-2">{balances}</div>}
    </div>
  );
}
