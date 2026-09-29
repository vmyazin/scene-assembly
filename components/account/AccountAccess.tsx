'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import AccountPageShell from './AccountPageShell';
import { AccountSurface } from './AccountSurface';
import { accountChanged, refreshAccount } from '@/lib/account/session';
import { afterSignIn } from '@/lib/account/return-path';
import { useAccountStore } from '@/store/useAccountStore';

export default function AccountAccess({ mode, signInFailed = false, returnTo }: { mode: 'sign-in' | 'sign-up'; signInFailed?: boolean; returnTo?: string }) {
  const router = useRouter();
  const session = useAccountStore(state => state.session);
  const status = useAccountStore(state => state.status);
  const [error, setError] = useState<string | null>(signInFailed ? 'Google sign-in was not completed. Please try again.' : null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'sign-up';
  const destination = afterSignIn(returnTo);

  useEffect(() => {
    if (status === 'ready' && session?.account) router.replace(destination);
  }, [router, session?.account, status, destination]);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const next = await refreshAccount();
      if (next.account) router.replace(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check your account.');
    } finally {
      setBusy(false);
    }
  }

  async function act(path: 'sign-in/google' | 'local-sign-in') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/account/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: destination }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Please try again.');
      if (path === 'sign-in/google') {
        const googleUrl = new URL(data.url);
        if (googleUrl.origin !== 'https://accounts.google.com') throw new Error('Invalid sign-in response.');
        window.location.assign(googleUrl.href);
      } else {
        accountChanged();
        const next = await refreshAccount();
        if (next.account) router.replace(destination);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = status === 'ready' && session?.account ? 'Opening your account…' : signup ? 'Make yourself at home.' : 'Welcome back.';
  const description = signup ? 'Create your Scene Assembly account with Google.' : 'Sign in to your Scene Assembly account with Google.';

  return (
    <AccountPageShell narrow title={title} description={description}>
      <AccountSurface label="Account access" className="mt-8">
        {status === 'loading' || (status === 'ready' && session?.account) ? (
          <p role="status" className="text-sm text-[var(--foreground-muted)]">Checking your account…</p>
        ) : status === 'unavailable' ? (
          <>
            <p role="alert" className="text-sm text-amber-300">Account service is temporarily unavailable. Please try again shortly.</p>
            <button type="button" disabled={busy} onClick={() => void retry()} className="btn-secondary mt-5 flex w-full justify-center"><RefreshCw size={15} aria-hidden="true" />{busy ? 'Checking…' : 'Try again'}</button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy || !session?.googleEnabled} onClick={() => void act('sign-in/google')} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--border-hover)] bg-white px-4 py-3 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand-accent)]"><GoogleMark />{busy ? 'Connecting…' : 'Continue with Google'}</button>
            {session && !session.googleEnabled && <p className="mt-3 text-sm text-[var(--foreground-muted)]">Google sign-in isn’t available yet. You can keep creating as a guest.</p>}
            {session?.localSignIn && <button type="button" disabled={busy} onClick={() => void act('local-sign-in')} className="btn-secondary mt-4 flex w-full justify-center">Use local test account</button>}
            <p className="mt-5 text-center text-sm leading-relaxed text-[var(--foreground-muted)]">An account is optional. You can create and download without signing in.</p>
          </>
        )}
        {error && <p role="alert" className="mt-4 text-sm leading-relaxed text-[var(--neon-pink)]">{error}</p>}
      </AccountSurface>
      {status === 'ready' && !session?.account && (() => {
        const carry = destination === '/account' ? '' : `?returnTo=${encodeURIComponent(destination)}`;
        return (
          <p className="mt-6 text-center text-sm text-[var(--foreground-muted)]">
            {signup ? 'Already have an account?' : 'New to Scene Assembly?'}{' '}
            <Link className="text-[var(--foreground)] underline underline-offset-4" href={signup ? `/sign-in${carry}` : `/sign-up${carry}`}>
              {signup ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        );
      })()}
    </AccountPageShell>
  );
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-1.9 4.6-4.1 6v5h6.6c3.9-3.6 6.1-8.9 6.1-14.7Z" /><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2C9.2 39.5 16.1 44 24 44Z" /><path fill="#FBBC05" d="M12.6 27.6c-.4-1.2-.6-2.4-.6-3.6s.2-2.4.6-3.6v-5.2H5.8A20 20 0 0 0 4 24c0 3.2.8 6.2 1.8 8.8l6.8-5.2Z" /><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.8 29.5 4 24 4 16.1 4 9.2 8.5 5.8 15.2l6.8 5.2C14.2 15.6 18.7 12 24 12Z" /></svg>;
}
