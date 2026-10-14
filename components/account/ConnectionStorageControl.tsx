'use client';

import { useState } from 'react';
import { CloudUpload, Loader2, Lock, MonitorSmartphone } from 'lucide-react';

import ConfirmDialog from '@/components/ConfirmDialog';
import { removeConnection, saveBrowserKey } from '@/lib/account/connection-sync';
import type { ImportableProvider } from '@/lib/account/key-import';
import { accountChanged, refreshAccount } from '@/lib/account/session';
import { ENGINES } from '@/lib/engines/registry';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';

const providerLabel = (provider: string) => ENGINES.find((engine) => engine.id === provider)?.label ?? provider;

/**
 * The action that changes where one provider's key is kept.
 *
 * Signed in, Save & close puts every key in both places, so this button is an
 * exit from that default rather than the route to it: the common case renders
 * nothing, "Remove from account" appears once the account holds the key, and
 * "Save to account" appears only for a provider previously opted out. Sits in
 * the card's header, opposite the title — `ConnectionStorageBadge` renders the
 * matching status line under the field, from the same store state, so the two
 * never disagree even though this is the only one of the pair that acts.
 */
export function ConnectionStorageButton({
  provider,
  apiKey,
  accountId,
}: {
  provider: ImportableProvider;
  apiKey: string;
  accountId?: string;
}) {
  const ownerId = useAccountStore((state) => state.session?.account?.id);
  const connection = useAccountStore((state) =>
    (state.session?.connections ?? []).find((entry) => entry.provider === provider)
  );
  const optedOut = useAppStore((state) => state.accountKeyOptOuts.includes(provider));
  const setOptOut = useAppStore((state) => state.setAccountKeyOptOut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const key = apiKey.trim();
  if (!ownerId || (!connection && !key)) return null;

  // `accountKeyOptOuts` is a flat, device-global store field — it is not
  // cleared on sign-out — so a write that resolves after the signed-in
  // account has changed must not touch it: that would leak one account's
  // removal into another account that never asked for it.
  function identityMatches(capturedEpoch: number) {
    const state = useAccountStore.getState();
    return state.epoch === capturedEpoch && state.session?.account?.id === ownerId;
  }

  async function run(action: () => Promise<unknown>, thenOptOut: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const capturedEpoch = useAccountStore.getState().epoch;
    try {
      await action();
      if (!identityMatches(capturedEpoch)) return;
      // The flag flips only after the write lands, so a failed removal does not
      // leave the provider opted out of a connection it still has.
      setOptOut(provider, thenOptOut);
      accountChanged();
      void refreshAccount().catch(() => {});
    } catch (cause) {
      if (!identityMatches(capturedEpoch)) return;
      setError(cause instanceof Error && cause.message ? cause.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(() => saveBrowserKey({ provider, apiKey: key, ...(accountId ? { accountId } : {}) }, ownerId), false);
  const remove = () => run(() => removeConnection(provider, ownerId), true);
  const name = providerLabel(provider);

  // The vault is write-only (spec: "Storage semantics: copy, not move"), so in
  // the row-4 state (spec's card-states table) the account's copy is the only
  // copy — a stray click here would destroy it with no way back. A confirm
  // step, not a second undo, is the only honest guard for a delete that
  // cannot be reversed.
  const button = connection ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => setConfirming(true)}
      aria-label={`Remove from account: ${name}`}
      className="btn-secondary shrink-0 gap-1.5 px-2 py-1 text-xs disabled:opacity-50"
    >
      {busy ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      Remove from account
    </button>
  ) : optedOut ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => void save()}
      aria-label={`Save to account: ${name}`}
      className="btn-secondary shrink-0 gap-1.5 border-[var(--neon-cyan)]/30 px-2 py-1 text-xs text-[var(--neon-cyan)] disabled:opacity-50"
    >
      {busy ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CloudUpload size={13} aria-hidden="true" />}
      Save to account
    </button>
  ) : null;

  if (!button && !error) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      {button}
      {error && (
        <p role="alert" className="max-w-[9.5rem] text-right text-xs text-red-300">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title="Remove this connection?"
        description="Jobs that still need this key may stop. Your existing saved assets remain available."
        confirmLabel="Remove connection"
        onConfirm={() => {
          setConfirming(false);
          void remove();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/**
 * Where one provider's key is kept, rendered under its field.
 *
 * Purely a reflection of the account connection list and the opt-out flag —
 * it holds no state of its own — so it can never drift from what
 * `ConnectionStorageButton` just did once that write lands.
 */
export function ConnectionStorageBadge({
  provider,
  apiKey,
}: {
  provider: ImportableProvider;
  apiKey: string;
}) {
  const ownerId = useAccountStore((state) => state.session?.account?.id);
  const connection = useAccountStore((state) =>
    (state.session?.connections ?? []).find((entry) => entry.provider === provider)
  );
  const optedOut = useAppStore((state) => state.accountKeyOptOuts.includes(provider));

  const key = apiKey.trim();
  if (!ownerId || (!connection && !key)) return null;

  const note = !key && connection
    ? 'Cloud jobs use it already. Browser-only runs need a key on this device.'
    : optedOut && key
      ? 'Kept off your account, so cloud jobs cannot use it.'
      : null;

  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--foreground-subtle)]">
        {key && (
          <span className="inline-flex items-center gap-1.5">
            <MonitorSmartphone size={13} aria-hidden="true" />On this device
          </span>
        )}
        {key && (connection || optedOut) && <span aria-hidden="true">·</span>}
        {connection ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-300">
            <Lock size={13} aria-hidden="true" />Encrypted in your account
            {!key && <span className="font-mono"> · ends ··{connection.hint}</span>}
          </span>
        ) : optedOut ? (
          <span>Not in your account</span>
        ) : null}
      </p>
      {note && <p className="text-xs leading-snug text-[var(--foreground-subtle)]">{note}</p>}
    </div>
  );
}
