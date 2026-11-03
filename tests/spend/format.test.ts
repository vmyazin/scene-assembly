// tests/spend/format.test.ts
import { describe, expect, it } from 'vitest';

import { formatUsd, formatUsdTotal, formatUsdTrimmed } from '@/lib/spend/format';
import { excerpt, providerLabel } from '@/lib/spend/ledger';

describe('formatUsd', () => {
  it('keeps four decimals for per-run figures', () => {
    expect(formatUsd(0.1344)).toBe('$0.1344');
  });
  it('floors sub-cent-of-a-cent figures instead of printing zero', () => {
    expect(formatUsd(0.00001)).toBe('<$0.0001');
  });
  it('treats nothing and nonsense as zero', () => {
    expect(formatUsd(0)).toBe('$0.0000');
    expect(formatUsd(Number.NaN)).toBe('$0.0000');
  });
});

describe('formatUsdTrimmed', () => {
  it('keeps a five-place catalog quote and drops trailing zeros', () => {
    expect(formatUsdTrimmed(0.02625)).toBe('0.02625');
    expect(formatUsdTrimmed(0.0175)).toBe('0.0175');
    expect(formatUsdTrimmed(0.03)).toBe('0.03');
  });
});

describe('formatUsdTotal', () => {
  it('rounds totals to cents', () => {
    expect(formatUsdTotal(12.3456)).toBe('$12.35');
  });
  it('flags a total that would round to nothing', () => {
    expect(formatUsdTotal(0.004)).toBe('<$0.01');
    expect(formatUsdTotal(0)).toBe('$0.00');
  });
});

describe('ledger helpers', () => {
  it('trims a prompt to 120 characters', () => {
    expect(excerpt(`${'a'.repeat(130)}`)).toHaveLength(120);
    expect(excerpt('  short  ')).toBe('short');
  });
  it('labels every engine and the helper tier', () => {
    expect(providerLabel('gemini')).toBe('Google Gemini');
    expect(providerLabel('micro-ai')).toBe('Helper tasks');
  });
});
