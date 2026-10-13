// lib/fal/pricing.ts
/**
 * How a fal endpoint's billing unit maps onto one of our runs. Dependency-free
 * so the estimate route and the client-side capture share one answer.
 */

/** Units fal bills as one per call. `request` and `call` appear on non-media endpoints. */
const ONE_PER_RUN = new Set(['image', 'video', 'request', 'call']);
const PER_SECOND = new Set(['second', 'seconds', 'sec']);

export function falUnitQuantity(unit: string, durationSeconds?: number): number | null {
  const normalized = unit.trim().toLowerCase();
  if (ONE_PER_RUN.has(normalized)) return 1;
  if (PER_SECOND.has(normalized)) {
    return durationSeconds !== undefined && durationSeconds > 0 ? durationSeconds : null;
  }
  // Per-megapixel and anything else needs the output size, which we do not know.
  return null;
}

/**
 * One duration control's value in seconds. Split out from `falDurationSeconds`
 * so a caller holding the raw value — rather than the whole control record —
 * reads it by the same rule instead of writing a second parseFloat.
 */
export function falSecondsFrom(raw: string | number | boolean | undefined): number | undefined {
  const seconds =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** fal duration controls are `5`, `'10'`, or `'8s'` depending on the model. */
export function falDurationSeconds(
  values: Record<string, string | number | boolean>
): number | undefined {
  // Edit models have no duration control. The Worker writes the container
  // length onto sourceDurationSeconds before reserve; a caller-supplied
  // number is not the price.
  return falSecondsFrom(values.duration) ?? falSecondsFrom(values.sourceDurationSeconds);
}
