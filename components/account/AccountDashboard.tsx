'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import AccountConsole from './AccountConsole';
import AccountPageShell from './AccountPageShell';
import { AccountSurface } from './AccountSurface';
import ApiKeyConfig from '@/components/ApiKeyConfig';
import { accountChanged, refreshAccount } from '@/lib/account/session';
import { useAccountStore } from '@/store/useAccountStore';

export default function AccountDashboard() {
  const router = useRouter();
  const session = useAccountStore(state => state.session);
  const status = useAccountStore(state => state.status);
  const epoch = useAccountStore(state => state.epoch);
  const scope = `${session?.account?.id ?? 'guest'}:${epoch}`;
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ scope: string; message: string } | null>(null);
  // Held here rather than inside `AccountConsole`: that component remounts on
  // its `key` below, which changes whenever `accountChanged()`/`refreshAccount()`
  // fires — exactly what the dialog's own storage buttons do on every save or
  // remove. State that lived inside it was destroyed by the click that just
  // used it, closing the dialog under the user. Owning it here, outside the
  // keyed element, survives that remount.
  const [managingKeys, setManagingKeys] = useState(false);
  const busy = busyScope === scope;
  const error = errorState?.scope === scope ? errorState.message : null;
  const account = status === 'ready' ? session?.account ?? null : null;

  useEffect(() => {
    if (status === 'ready' && !session?.account) router.replace('/sign-in');
  }, [router, session?.account, status]);

  async function retry() {
    const capturedScope = scope;
    setBusyScope(capturedScope);
    setErrorState(null);
    try {
      await refreshAccount();
    } catch (reason) {
      if (currentScope() === capturedScope) setErrorState({ scope: capturedScope, message: reason instanceof Error ? reason.message : 'Could not check your account.' });
    } finally {
      setBusyScope(current => current === capturedScope ? null : current);
    }
  }

  async function signOut(ownerId: string, ownerEpoch: number) {
    const capturedScope = `${ownerId}:${ownerEpoch}`;
    if (currentScope() !== capturedScope) return;
    setBusyScope(capturedScope);
    setErrorState(null);
    try {
      const response = await fetch('/api/account/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Account-Id': ownerId },
        body: JSON.stringify({ returnTo: '/account' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not sign out.');
      if (currentScope() !== capturedScope) return;
      accountChanged(true);
      await refreshAccount().catch(() => undefined);
      router.replace('/sign-in');
    } catch (reason) {
      if (currentScope() === capturedScope) setErrorState({ scope: capturedScope, message: reason instanceof Error ? reason.message : 'Could not sign out.' });
    } finally {
      setBusyScope(current => current === capturedScope ? null : current);
    }
  }

  function currentScope() {
    const current = useAccountStore.getState();
    return `${current.session?.account?.id ?? 'guest'}:${current.epoch}`;
  }

  if (status === 'loading') {
    return <AccountState><p role="status" className="text-sm text-[var(--foreground-muted)]">Checking your account…</p></AccountState>;
  }

  if (status === 'unavailable') {
    return (
      <AccountState>
        <p role="alert" className="text-sm text-amber-300">Account service is temporarily unavailable. Your account data has not been changed.</p>
        <button type="button" disabled={busy} onClick={() => void retry()} className="btn-secondary mt-5 w-full">
          <RefreshCw size={15} aria-hidden="true" />{busy ? 'Checking…' : 'Try again'}
        </button>
        {error && <p role="alert" className="mt-4 text-sm text-[var(--neon-pink)]">{error}</p>}
      </AccountState>
    );
  }

  if (!account) {
    return (
      <AccountPageShell eyebrow={null} narrow title="Your account" description="Your cloud workspace, saved provider connections, and private library.">
        <p role="status" className="mt-8 text-sm text-[var(--foreground-muted)]">Taking you to sign in…</p>
      </AccountPageShell>
    );
  }

  return (
    <AccountPageShell eyebrow={null} wide title="Your account" description="Manage the work and provider connections saved to your private cloud account.">
      <AccountConsole
        key={`${account.id}:${epoch}`}
        account={account}
        localTest={session?.localSignIn}
        busy={busy}
        error={error}
        onSignOut={() => void signOut(account.id, epoch)}
        onManageKeys={() => setManagingKeys(true)}
      />
      <ApiKeyConfig open={managingKeys} onOpenChange={setManagingKeys} />
    </AccountPageShell>
  );
}

function AccountState({ children }: { children: React.ReactNode }) {
  return (
    <AccountPageShell eyebrow={null} narrow title="Your account" description="Your cloud workspace, saved provider connections, and private library.">
      <AccountSurface label="Account status" className="mt-8">{children}</AccountSurface>
    </AccountPageShell>
  );
}
