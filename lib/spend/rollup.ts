// lib/spend/rollup.ts
/**
 * Pure arithmetic over ledger entries. The page renders these and adds nothing
 * of its own, so every figure it shows is testable here without React.
 */
import { providerLabel, type SpendEntry, type SpendKind, type SpendProvider } from './ledger';

// No all-time range: the overview shows the all-time total in its own tile, so
// a range that repeated it only made the selector longer.
export type SpendRange = 'month' | '7d' | '30d';

export const SPEND_RANGES: ReadonlyArray<{ value: SpendRange; label: string }> = [
  { value: 'month', label: 'This month' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export function isSpendRange(value: unknown): value is SpendRange {
  return value === 'month' || value === '7d' || value === '30d';
}

/** Local-time start of the range; day ranges count today as their last day. */
export function rangeStart(range: SpendRange, now: number): number {
  const date = new Date(now);
  if (range === 'month') return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const days = range === '7d' ? 7 : 30;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (days - 1)).getTime();
}

export function inRange(entries: SpendEntry[], range: SpendRange, now: number): SpendEntry[] {
  const start = rangeStart(range, now);
  return entries.filter((entry) => entry.at >= start);
}

export interface SpendTotals {
  costUsd: number;
  runs: number;
  exactUsd: number;
  estimatedUsd: number;
  unknownRuns: number;
}

export function totals(entries: SpendEntry[]): SpendTotals {
  const result: SpendTotals = { costUsd: 0, runs: 0, exactUsd: 0, estimatedUsd: 0, unknownRuns: 0 };
  for (const entry of entries) {
    result.runs += 1;
    if (entry.costUsd === null) {
      result.unknownRuns += 1;
      continue;
    }
    result.costUsd += entry.costUsd;
    if (entry.confidence === 'exact') result.exactUsd += entry.costUsd;
    else result.estimatedUsd += entry.costUsd;
  }
  return result;
}

export interface SpendRow {
  key: string;
  label: string;
  /** Set on model rows so the table can show the provider's logo. */
  provider?: SpendProvider;
  runs: number;
  costUsd: number;
  unknownRuns: number;
}

function group(
  entries: SpendEntry[],
  keyOf: (entry: SpendEntry) => string,
  describe: (entry: SpendEntry) => Pick<SpendRow, 'label' | 'provider'>
): SpendRow[] {
  const rows = new Map<string, SpendRow>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const row = rows.get(key) ?? { key, ...describe(entry), runs: 0, costUsd: 0, unknownRuns: 0 };
    row.runs += 1;
    if (entry.costUsd === null) row.unknownRuns += 1;
    else row.costUsd += entry.costUsd;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);
}

export function byProvider(entries: SpendEntry[]): SpendRow[] {
  return group(
    entries,
    (entry) => entry.provider,
    (entry) => ({ label: providerLabel(entry.provider), provider: entry.provider })
  );
}

export function byModel(entries: SpendEntry[]): SpendRow[] {
  return group(
    entries,
    (entry) => `${entry.provider}:${entry.modelId}`,
    (entry) => ({ label: entry.modelId, provider: entry.provider })
  );
}

const KIND_LABELS: Record<SpendKind, string> = { image: 'Images', video: 'Video', helper: 'Helper tasks' };

export function byKind(entries: SpendEntry[]): SpendRow[] {
  return group(
    entries,
    (entry) => entry.kind,
    (entry) => ({ label: KIND_LABELS[entry.kind] })
  );
}

/** Local calendar day as YYYY-MM-DD, so a day boundary matches what the user sees. */
export function dayKey(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface SpendDay {
  day: string;
  costUsd: number;
  runs: number;
  byProvider: Partial<Record<SpendProvider, number>>;
}

/** One row per day from the range start through today, zero-filled. */
export function byDay(entries: SpendEntry[], range: SpendRange, now: number): SpendDay[] {
  const first = new Date(rangeStart(range, now));
  const last = new Date(now);
  const days: SpendDay[] = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate());
  while (cursor.getTime() <= end.getTime()) {
    days.push({ day: dayKey(cursor.getTime()), costUsd: 0, runs: 0, byProvider: {} });
    cursor.setDate(cursor.getDate() + 1);
  }
  const index = new Map(days.map((day) => [day.day, day]));
  for (const entry of entries) {
    const day = index.get(dayKey(entry.at));
    if (!day) continue;
    day.runs += 1;
    if (entry.costUsd === null) continue;
    day.costUsd += entry.costUsd;
    day.byProvider[entry.provider] = (day.byProvider[entry.provider] ?? 0) + entry.costUsd;
  }
  return days;
}

function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  // A leading =, +, -, @, tab, or CR is a formula trigger in Excel/Sheets; prefix with
  // ' so a pasted prompt like `=HYPERLINK(...)` renders as text instead of executing.
  const text = /^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(entries: SpendEntry[]): string {
  const header = 'at,provider,model,kind,input_mode,quantity,unit,cost_usd,confidence,source,prompt';
  const rows = entries.map((entry) =>
    [
      new Date(entry.at).toISOString(),
      entry.provider,
      entry.modelId,
      entry.kind,
      entry.inputMode,
      entry.quantity?.value,
      entry.quantity?.unit,
      entry.costUsd,
      entry.confidence,
      entry.source,
      entry.promptExcerpt,
    ]
      .map(csvCell)
      .join(',')
  );
  return [header, ...rows].join('\n');
}
