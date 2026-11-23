// lib/providers/use-sale-clock.ts
import { useEffect, useState } from 'react';

import { nextPromotionBoundary } from './model-promotions';

/** `setTimeout` takes a signed 32-bit delay; a longer wait is re-armed when it fires. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Re-renders the caller at the instant a dated sale opens or closes.
 *
 * `withModelSale` answers for the time it is asked, so a price is right on
 * every render. A tab left open across the end of a sale does not render: the
 * picker and the estimate kept the sale price until something else changed
 * state, and the first press after the sale was made looking at it. This arms
 * one timer for the next boundary and bumps a counter when it passes.
 *
 * Returns the counter, which a caller may ignore. The render is the point.
 */
export function useSaleClock(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const boundary = nextPromotionBoundary();
    if (boundary === undefined) return;
    const timer = setTimeout(() => setTick((value) => value + 1), Math.min(MAX_TIMEOUT_MS, Math.max(0, boundary - Date.now())));
    return () => clearTimeout(timer);
  }, [tick]);
  return tick;
}
