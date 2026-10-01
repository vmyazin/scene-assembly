// lib/moderation/flag.ts
/**
 * Rollout switch from the spec. Unset means `off`: the toggle stays hidden
 * until an operator sets `NEXT_PUBLIC_RELAXED_FILTER` to `admin` or `all`.
 * The A/B that would justify `all` has not been run.
 *
 * This module stays free of the admin gate so client components can read the
 * flag. Whether a Next route actually applies Relaxed is `serverHonorsRelaxed`.
 */
export type RelaxedFilterFlag = 'off' | 'admin' | 'all';

export function relaxedFilterFlag(): RelaxedFilterFlag {
  const raw = (process.env.NEXT_PUBLIC_RELAXED_FILTER ?? 'off').trim().toLowerCase();
  if (raw === 'admin' || raw === 'all' || raw === 'off') return raw;
  return 'off';
}

/** Whether the toggle is offered in this build. `admin` still shows it; the server checks the gate. */
export function relaxedFilterEnabled(): boolean {
  return relaxedFilterFlag() !== 'off';
}
