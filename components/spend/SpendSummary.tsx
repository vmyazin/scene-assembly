import { formatUsdTotal } from '@/lib/spend/format';
import type { SpendTotals } from '@/lib/spend/rollup';

interface SpendSummaryProps {
  /** Null while a total computed elsewhere is still on its way. */
  totals: SpendTotals | null;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-card p-3.5 md:p-4">
      <dt className="field-label">{label}</dt>
      <dd className="display mt-1 text-2xl">{value}</dd>
      {hint && <p className="field-hint mt-1">{hint}</p>}
    </div>
  );
}

export default function SpendSummary({ totals }: SpendSummaryProps) {
  if (!totals) {
    return (
      <section aria-label="Summary" aria-busy="true">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Total" value="—" hint="Totalling…" />
          <Tile label="Runs" value="—" />
          <Tile label="Exact" value="—" />
        </dl>
      </section>
    );
  }
  const exactShare = totals.costUsd > 0 ? Math.round((totals.exactUsd / totals.costUsd) * 100) : 0;
  return (
    <section aria-label="Summary">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total" value={formatUsdTotal(totals.costUsd)} hint={totals.unknownRuns > 0 ? `${totals.unknownRuns} run${totals.unknownRuns === 1 ? '' : 's'} unpriced` : undefined} />
        <Tile label="Runs" value={String(totals.runs)} />
        <Tile label="Exact" value={`${exactShare}%`} hint={`${formatUsdTotal(totals.estimatedUsd)} estimated`} />
      </dl>
    </section>
  );
}
