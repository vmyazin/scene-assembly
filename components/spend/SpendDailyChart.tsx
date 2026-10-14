import { useId, useState } from 'react';

import { formatUsdTotal } from '@/lib/spend/format';
import { providerLabel } from '@/lib/spend/ledger';
import { PROVIDER_FILL, PROVIDER_ORDER } from '@/lib/spend/palette';
import type { SpendDay } from '@/lib/spend/rollup';

const WIDTH = 640;
const HEIGHT = 200;
const PAD_LEFT = 42;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;
/** Surface-color gap between stacked segments and between neighboring bars. */
const GAP = 2;
/** Bars never grow wider than this, however few days are in the range. */
const MAX_BAR = 24;

/** Rounds a raw max up to a clean 1/2/5 step, so the axis reads at a glance. */
function niceMax(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** A rect path with the top two corners rounded and the baseline square. */
function roundedTopPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, height, width / 2));
  if (r === 0) return `M${x},${y} h${width} v${height} h${-width} Z`;
  return [
    `M${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    `L${x},${y + height}`,
    'Z',
  ].join(' ');
}

interface HoveredDay {
  index: number;
  /** Center of the bar, as a percentage of the chart width — used to place the HTML tooltip. */
  leftPct: number;
}

export default function SpendDailyChart({ days }: { days: SpendDay[] }) {
  const titleId = useId();
  const [hovered, setHovered] = useState<HoveredDay | null>(null);

  const rawMax = Math.max(...days.map((day) => day.costUsd), 0);
  const domainMax = niceMax(rawMax);
  const plotWidth = WIDTH - PAD_LEFT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotHeight;
  const slot = plotWidth / Math.max(days.length, 1);
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot - GAP * 2));
  const scale = (usd: number) => (domainMax > 0 ? (usd / domainMax) * plotHeight : 0);
  const labelEvery = days.length > 14 ? Math.ceil(days.length / 6) : 1;

  const providersPresent = PROVIDER_ORDER.filter((provider) =>
    days.some((day) => (day.byProvider[provider] ?? 0) > 0)
  );

  const ticks = domainMax > 0 ? [0, domainMax / 2, domainMax] : [0];
  const hoveredDay = hovered ? days[hovered.index] : null;

  return (
    <section aria-label="Daily spend" className="glass-card p-3.5 md:p-4">
      <h2 className="field-label mb-2">Per day</h2>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={titleId}
          className="h-44 w-full overflow-visible"
        >
          <title id={titleId}>Spend per day, stacked by provider</title>

          {/* Gridlines: recessive hairlines, the axis carries the numbers no bar is directly labeled with. */}
          {ticks.map((tick) => {
            const y = baseline - scale(tick);
            return (
              <g key={tick}>
                <line
                  x1={PAD_LEFT}
                  x2={WIDTH}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text x={PAD_LEFT - 6} y={y} dy="0.32em" textAnchor="end" fontSize="9" fill="var(--foreground-muted)">
                  {formatUsdTotal(tick)}
                </text>
              </g>
            );
          })}

          {days.map((day, index) => {
            const visible = PROVIDER_ORDER.filter((provider) => (day.byProvider[provider] ?? 0) > 0);
            const x = PAD_LEFT + index * slot + (slot - barWidth) / 2;
            const isHovered = hovered?.index === index;
            const leftPct = ((x + barWidth / 2) / WIDTH) * 100;
            const dayLabel = `${day.day}: ${formatUsdTotal(day.costUsd)} across ${day.runs} run${day.runs === 1 ? '' : 's'}`;
            let y = baseline;

            const enter = () => setHovered({ index, leftPct });
            const leave = () => setHovered((current) => (current?.index === index ? null : current));

            return (
              <g
                key={day.day}
                tabIndex={0}
                aria-label={dayLabel}
                opacity={hovered && !isHovered ? 0.55 : 1}
                style={{ transition: 'opacity 120ms ease' }}
                onMouseEnter={enter}
                onMouseLeave={leave}
                onFocus={enter}
                onBlur={leave}
              >
                {/* Hit target wider than the bar itself, covering the day's whole slot and full plot height.
                    Drawn beneath the segments (not on top) so their native <title> tooltips stay reachable
                    by mouse; hover/focus is detected on the whole <g>, not this rect specifically. */}
                <rect x={PAD_LEFT + index * slot} y={PAD_TOP} width={slot} height={plotHeight} fill="transparent" />
                {visible.map((provider, segmentIndex) => {
                  const usd = day.byProvider[provider] ?? 0;
                  const height = scale(usd);
                  const top = y - height;
                  const isTopSegment = segmentIndex === visible.length - 1;
                  const fill = PROVIDER_FILL[provider];
                  const path = isTopSegment
                    ? roundedTopPath(x, top, barWidth, height, 4)
                    : `M${x},${top} h${barWidth} v${height} h${-barWidth} Z`;
                  y = top - GAP;
                  return (
                    <path key={provider} d={path} fill={fill.color} fillOpacity={fill.opacity}>
                      <title>{`${day.day} — ${providerLabel(provider)}: ${formatUsdTotal(usd)}`}</title>
                    </path>
                  );
                })}
                {/* Hover/focus lift: a translucent surface-color wash lightens the whole stack together. */}
                {isHovered && (
                  <rect x={x} y={PAD_TOP} width={barWidth} height={plotHeight} fill="var(--foreground)" fillOpacity={0.12} />
                )}
                {index % labelEvery === 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--foreground-muted)"
                  >
                    {day.day.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hoveredDay && hovered && (
          <div
            className="glass-card pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 p-2 text-xs"
            style={{ left: `${hovered.leftPct}%` }}
          >
            <p className="font-mono text-[var(--foreground-muted)]">{hoveredDay.day}</p>
            <p className="display mt-0.5 text-sm">{formatUsdTotal(hoveredDay.costUsd)}</p>
            <ul className="mt-1.5 space-y-1">
              {PROVIDER_ORDER.filter((provider) => (hoveredDay.byProvider[provider] ?? 0) > 0).map((provider) => (
                <li key={provider} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-[var(--foreground-muted)]">
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: PROVIDER_FILL[provider].color, opacity: PROVIDER_FILL[provider].opacity }}
                    />
                    <span className="truncate">{providerLabel(provider)}</span>
                  </span>
                  <span className="font-mono">{formatUsdTotal(hoveredDay.byProvider[provider] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {providersPresent.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
          {providersPresent.map((provider) => (
            <li key={provider} className="flex items-center gap-1.5 text-[0.75rem] text-[var(--foreground-muted)]">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: PROVIDER_FILL[provider].color, opacity: PROVIDER_FILL[provider].opacity }}
              />
              {providerLabel(provider)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
