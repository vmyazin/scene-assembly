// lib/spend/format.ts

/** Sub-cent figures round to nothing, so show a floor rather than "$0.0000". */
export function formatUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '$0.0000';
  return cost < 0.0001 ? '<$0.0001' : `$${cost.toFixed(4)}`;
}

/**
 * A catalog quote beside "Est. ≈", without a dollar sign. Five places, then
 * drop trailing zeros, so $0.0175 and $0.02625 stay exact. Four places turns
 * 0.02625 into 0.0262.
 */
export function formatUsdTrimmed(cost: number): string {
  if (!Number.isFinite(cost)) return '0';
  return cost.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}

/** Totals read in cents; a total under a cent still says it is not nothing. */
export function formatUsdTotal(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '$0.00';
  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
}
