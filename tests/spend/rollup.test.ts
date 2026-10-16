import { describe, expect, it } from 'vitest';

import type { SpendEntry } from '@/lib/spend/ledger';
import {
  byDay,
  byKind,
  byModel,
  byProvider,
  inRange,
  isSpendRange,
  rangeStart,
  toCsv,
  totals,
} from '@/lib/spend/rollup';

// Local noon avoids any day boundary in whatever zone the runner is in.
const NOW = new Date(2026, 8, 15, 12, 0, 0).getTime(); // 2026-09-15
const DAY = 24 * 60 * 60 * 1_000;

function entry(overrides: Partial<SpendEntry>): SpendEntry {
  return {
    id: Math.random().toString(36).slice(2),
    at: NOW,
    provider: 'runware',
    modelId: 'runware:z-image@turbo',
    kind: 'image',
    costUsd: 0.01,
    confidence: 'exact',
    source: 'response',
    promptExcerpt: 'A harbour',
    ...overrides,
  };
}

describe('ranges', () => {
  it('recognises the three ranges', () => {
    expect(isSpendRange('month')).toBe(true);
    expect(isSpendRange('7d')).toBe(true);
    expect(isSpendRange('30d')).toBe(true);
    expect(isSpendRange('all')).toBe(false);
    expect(isSpendRange('week')).toBe(false);
  });

  it('starts the month at local midnight on the first', () => {
    expect(rangeStart('month', NOW)).toBe(new Date(2026, 8, 1).getTime());
  });

  it('counts 30 days inclusive of today', () => {
    expect(rangeStart('30d', NOW)).toBe(new Date(2026, 7, 17).getTime());
  });

  it('counts 7 days inclusive of today', () => {
    expect(rangeStart('7d', NOW)).toBe(new Date(2026, 8, 9).getTime());
  });

  it('filters by the range start', () => {
    const inside = entry({ at: NOW - DAY });
    const outside = entry({ at: NOW - 40 * DAY });
    expect(inRange([inside, outside], '30d', NOW)).toEqual([inside]);
    expect(inRange([inside, entry({ at: NOW - 8 * DAY })], '7d', NOW)).toEqual([inside]);
  });
});

describe('totals', () => {
  it('sums by confidence and counts unknowns separately', () => {
    const result = totals([
      entry({ costUsd: 0.1, confidence: 'exact' }),
      entry({ costUsd: 0.2, confidence: 'estimated' }),
      entry({ costUsd: null, confidence: 'unknown' }),
    ]);
    expect(result).toEqual({
      costUsd: expect.closeTo(0.3, 6),
      runs: 3,
      exactUsd: expect.closeTo(0.1, 6),
      estimatedUsd: expect.closeTo(0.2, 6),
      unknownRuns: 1,
    });
  });
});

describe('groupings', () => {
  const entries = [
    entry({ provider: 'gemini', modelId: 'gemini-3-pro-image-preview', costUsd: 0.13 }),
    entry({ provider: 'gemini', modelId: 'gemini-3-pro-image-preview', costUsd: 0.24 }),
    entry({ provider: 'runware', modelId: 'runware:z-image@turbo', costUsd: 0.003 }),
    entry({ provider: 'kie', modelId: 'veo-3-1', kind: 'video', costUsd: null, confidence: 'unknown' }),
  ];

  it('groups by provider, most expensive first, with labels', () => {
    expect(byProvider(entries).map((row) => [row.key, row.label, row.runs, row.unknownRuns])).toEqual([
      ['gemini', 'Google Gemini', 2, 0],
      ['runware', 'Runware', 1, 0],
      ['kie', 'Kie.ai', 1, 1],
    ]);
    expect(byProvider(entries)[0].costUsd).toBeCloseTo(0.37, 6);
  });

  it('groups by model and remembers the provider for the logo', () => {
    const rows = byModel(entries);
    expect(rows[0]).toMatchObject({ key: 'gemini:gemini-3-pro-image-preview', label: 'gemini-3-pro-image-preview', provider: 'gemini', runs: 2 });
  });

  it('groups by kind', () => {
    expect(byKind(entries).map((row) => [row.key, row.runs])).toEqual([
      ['image', 3],
      ['video', 1],
    ]);
  });
});

describe('byDay', () => {
  it('zero-fills every day in the range and stacks by provider', () => {
    const days = byDay(
      [
        entry({ at: NOW, provider: 'gemini', costUsd: 0.1 }),
        entry({ at: NOW, provider: 'runware', costUsd: 0.01 }),
        entry({ at: NOW - 2 * DAY, provider: 'gemini', costUsd: 0.2 }),
      ],
      '30d',
      NOW
    );
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toEqual({
      day: '2026-09-15',
      costUsd: expect.closeTo(0.11, 6),
      runs: 2,
      byProvider: { gemini: 0.1, runware: 0.01 },
    });
    expect(days.at(-3)?.costUsd).toBeCloseTo(0.2, 6);
    expect(days.at(-2)).toEqual({ day: '2026-09-14', costUsd: 0, runs: 0, byProvider: {} });
  });

  it('spans seven days for the week range, even when empty', () => {
    expect(byDay([], '7d', NOW)).toHaveLength(7);
  });
});

describe('toCsv', () => {
  it('writes a header and quotes prompts', () => {
    const csv = toCsv([
      entry({ at: Date.UTC(2026, 8, 15, 12), promptExcerpt: 'A "quoted", prompt', quantity: { unit: 'second', value: 5 } }),
    ]);
    const [header, row] = csv.split('\n');
    expect(header).toBe('at,provider,model,kind,input_mode,quantity,unit,cost_usd,confidence,source,prompt');
    expect(row).toBe('2026-09-15T12:00:00.000Z,runware,runware:z-image@turbo,image,,5,second,0.01,exact,response,"A ""quoted"", prompt"');
  });

  it('neutralizes a prompt that looks like a spreadsheet formula', () => {
    const csv = toCsv([entry({ promptExcerpt: '=HYPERLINK("x")' })]);
    const row = csv.split('\n')[1];
    expect(row.endsWith('"\'=HYPERLINK(""x"")"')).toBe(true);
  });
});
