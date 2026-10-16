/**
 * A static, non-animated outline of the spend report shown before anything is
 * recorded. Section labels are real so the reader learns the page's shape; the
 * values are neutral blocks. It is decorative, so it is hidden from assistive
 * tech and the empty-state message above it carries the meaning.
 */

const WIDTH = 640;
const HEIGHT = 200;
const PAD_LEFT = 42;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;
const BAR_WIDTH = 24;
const SLOT = 44;
/** Fixed bar heights as a share of the plot, so the outline is stable between renders. */
const GHOST_BARS = [0.35, 0.55, 0.3, 0.7, 0.45, 0.6, 0.25, 0.5, 0.65, 0.4, 0.55, 0.3];

function Bone({ className }: { className: string }) {
  return <span className={`block rounded bg-[var(--foreground-muted)]/20 ${className}`} />;
}

function Tile({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div className={`glass-card p-3.5 md:p-4 ${className}`}>
      <p className="field-label">{label}</p>
      <Bone className="mt-2 h-7 w-20" />
    </div>
  );
}

function Breakdown({ title }: { title: string }) {
  return (
    <section className="glass-card p-3.5 md:p-4">
      <h2 className="field-label mb-2">{title}</h2>
      <div className="divide-y divide-[var(--border)]">
        {[0.8, 0.55, 0.3].map((share) => (
          <div key={share} className="flex items-center gap-3 py-2.5">
            <div className="flex-1">
              <Bone className="h-3 w-28" />
              <div className="mt-1.5 h-1 rounded bg-[var(--foreground-muted)]/10">
                <div className="h-1 rounded bg-[var(--foreground-muted)]/35" style={{ width: `${share * 100}%` }} />
              </div>
            </div>
            <Bone className="h-3 w-6" />
            <Bone className="h-3 w-12" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SpendEmptyPreview() {
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotHeight;
  const ticks = [0, 0.5, 1];

  return (
    <div aria-hidden="true" className="space-y-4 opacity-80 select-none">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-[1.6fr_1fr_1fr]">
        <Tile label="Total" className="col-span-2 md:col-span-1" />
        <Tile label="Runs" />
        <Tile label="All time" />
      </div>

      <section className="glass-card p-3.5 md:p-4">
        <h2 className="field-label mb-2">Per day</h2>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full overflow-visible">
          {ticks.map((tick) => {
            const y = baseline - tick * plotHeight;
            return (
              <g key={tick}>
                <line x1={PAD_LEFT} x2={WIDTH} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <rect x={PAD_LEFT - 30} y={y - 4} width={24} height={8} rx={2} fill="var(--foreground-muted)" fillOpacity={0.2} />
              </g>
            );
          })}
          {GHOST_BARS.map((share, index) => {
            const height = share * plotHeight;
            const x = PAD_LEFT + index * SLOT + (SLOT - BAR_WIDTH) / 2;
            return (
              <g key={index}>
                <rect x={x} y={baseline - height} width={BAR_WIDTH} height={height} rx={3} fill="var(--foreground-muted)" fillOpacity={0.2} />
                <rect x={x} y={baseline + 8} width={BAR_WIDTH} height={6} rx={2} fill="var(--foreground-muted)" fillOpacity={0.2} />
              </g>
            );
          })}
        </svg>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title="By provider" />
        <Breakdown title="By model" />
      </div>

      <section className="glass-card p-3.5 md:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="field-label">Ledger</h2>
          <div className="flex items-center gap-2">
            <Bone className="h-8 w-24" />
            <Bone className="h-8 w-24" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[0.8125rem] text-[var(--foreground-muted)]">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Model</th>
                <th className="py-2 pr-3 font-medium">Kind</th>
                <th className="py-2 pr-3 font-medium">Prompt</th>
                <th className="py-2 pr-3 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((row) => (
                <tr key={row} className="border-t border-[var(--border)]">
                  <td className="py-3 pr-3"><Bone className="h-3 w-24" /></td>
                  <td className="py-3 pr-3"><Bone className="h-3 w-16" /></td>
                  <td className="py-3 pr-3"><Bone className="h-3 w-28" /></td>
                  <td className="py-3 pr-3"><Bone className="h-3 w-12" /></td>
                  <td className="py-3 pr-3"><Bone className="h-3 w-full max-w-[16rem]" /></td>
                  <td className="py-3 pr-3"><Bone className="ml-auto h-3 w-10" /></td>
                  <td className="py-3"><Bone className="ml-auto h-3 w-12" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
