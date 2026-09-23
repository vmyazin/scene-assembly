'use client';

import { useCallback, useEffect, useState } from 'react';

import type { SpendTotals } from '@/lib/spend/rollup';
import { useAccountStore } from '@/store/useAccountStore';
import { accountRequest } from './client';

/**
 * Spend totals for the account rail (all time) and the /spend summary tiles
 * (from `since`, the selected range's start).
 *
 * Deliberately not `useAccountSpend`: that hook pages the ledger fifty entries
 * at a time for the report, and summing what it happens to have loaded would
 * quietly under-report any account past its first page. The Worker reduces the
 * whole ledger instead and returns one object.
 *
 * Totals are memory-only and scoped to owner + epoch + range, like every other
 * account read, so a session change can never leave one account's figure on
 * screen under another account's name.
 */
export function useAccountSpendTotals(ownerId: string, since: number | null = null) {
  const epoch = useAccountStore(state => state.epoch);
  const scope = `${ownerId}:${epoch}:${since ?? 'all'}`;
  const [state, setState] = useState<{ scope: string; totals: SpendTotals | null; error: string | null }>({ scope, totals: null, error: null });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    // No synchronous reset here: `visible` below already withholds a previous
    // owner's figure, and a refresh keeps the last figure until the new one lands.
    accountRequest<{ accountId: string; totals: SpendTotals }>(`spend/totals${since === null ? '' : `?since=${since}`}`, {
      signal: controller.signal,
      headers: { 'X-Account-Id': ownerId },
    })
      .then(response => {
        if (controller.signal.aborted || response.accountId !== ownerId || !response.totals) return;
        setState({ scope, totals: response.totals, error: null });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({ scope, totals: null, error: error instanceof Error && error.message ? error.message : 'Could not load spend.' });
      });
    return () => controller.abort();
  }, [ownerId, scope, since, revision]);

  const visible = state.scope === scope;
  return { totals: visible ? state.totals : null, error: visible ? state.error : null, refresh };
}
