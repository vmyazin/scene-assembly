import { accountChanged, refreshAccount } from './session';
import { useAccountStore } from '@/store/useAccountStore';

/**
 * End the session on this device, wherever the request came from.
 *
 * It lived inside `AccountDashboard` while /account was the only place to sign
 * out. The studio header offers it too now, and the two callers differ only in
 * what happens afterwards: /account has nothing to show a guest and moves on to
 * /sign-in, while the studio works without an account and stays where it is.
 * So this resolves `true` once the session is gone and leaves the navigation to
 * the caller; neither gets it by default.
 *
 * Resolves `false`, having changed nothing, when the account on screen is no
 * longer the one that asked (another tab signed out or switched first). Throws
 * the service's message when the request fails.
 */
export async function signOut(ownerId: string, ownerEpoch: number, returnTo = '/'): Promise<boolean> {
  const stillCurrent = () => {
    const state = useAccountStore.getState();
    return state.session?.account?.id === ownerId && state.epoch === ownerEpoch;
  };
  if (!stillCurrent()) return false;
  const response = await fetch('/api/account/sign-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Account-Id': ownerId },
    body: JSON.stringify({ returnTo }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Could not sign out.');
  if (!stillCurrent()) return false;
  accountChanged(true);
  // More than one read, because the first is usually thrown away.
  // `accountChanged` also posts to the `scene-account` BroadcastChannel, and
  // `AccountSessionProvider` on this same page hears that a moment later and
  // clears the store again. That bumps the epoch under the read already in
  // flight, so its answer is discarded and the store is left on `loading` until
  // the provider's idle poll a minute on. /account never showed it, because it
  // navigates to /sign-in, which reads the session itself; the studio header
  // stays put and sat on an empty ring. Asking again once the store has settled
  // on its new epoch gets an answer that is kept.
  for (let attempt = 0; attempt < 3; attempt++) {
    await refreshAccount().catch(() => undefined);
    if (useAccountStore.getState().status !== 'loading') break;
  }
  return true;
}
