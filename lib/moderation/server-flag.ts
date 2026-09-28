// lib/moderation/server-flag.ts
import { relaxedFilterFlag } from './flag';

/**
 * Whether a Next route should apply Relaxed for this caller.
 * `admin` uses the existing admin gate: the flag is on and the caller is an
 * approved account. A public deploy with the gate unset does not honor it.
 *
 * The gate module is imported only in that case. A static import pulls
 * `node:sqlite` into every generation route, and the jsdom tests that load
 * those routes cannot bundle that built-in.
 */
export async function serverHonorsRelaxed(request?: Request): Promise<boolean> {
  const flag = relaxedFilterFlag();
  if (flag === 'off') return false;
  if (flag === 'all') return true;
  const gate = await import(/* @vite-ignore */ '../auth/guard');
  if (!gate.isGateEnabled() || !request) return false;
  return !gate.isGateFailure(gate.requireApprovedAccount(request));
}
