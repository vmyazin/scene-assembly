'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, LockKeyhole } from 'lucide-react';
import { ENGINES } from '@/lib/engines/registry';
import { browserKeyCandidates, importBrowserKey, type ImportableProvider } from '@/lib/account/key-import';
import { accountChanged, refreshAccount } from '@/lib/account/session';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { AccountSurface } from './AccountSurface';

const labels = new Map(ENGINES.map(engine => [engine.id, engine.label]));

export default function AccountKeyImport({ ownerId }: { ownerId: string }) {
  const hasHydrated = useAppStore(state => state.hasHydrated);
  const apiKey = useAppStore(state => state.apiKey);
  const cfToken = useAppStore(state => state.cfToken);
  const cfAccountId = useAppStore(state => state.cfAccountId);
  const kieApiKey = useAppStore(state => state.kieApiKey);
  const falApiKey = useAppStore(state => state.falApiKey);
  const runwareApiKey = useAppStore(state => state.runwareApiKey);
  const atlasApiKey = useAppStore(state => state.atlasApiKey);
  const piapiApiKey = useAppStore(state => state.piapiApiKey);
  const cometApiKey = useAppStore(state => state.cometApiKey);
  const connections = useAccountStore(state => state.session?.connections ?? []);
  const epoch = useAccountStore(state => state.epoch);
  const [selected, setSelected] = useState<Set<ImportableProvider>>(new Set());
  const [imported, setImported] = useState<Set<ImportableProvider>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (!useAppStore.getState().hasHydrated) void useAppStore.persist.rehydrate();
    return () => { mounted.current = false; };
  }, []);

  const saved = useMemo(() => new Set(connections.map(connection => connection.provider)), [connections]);
  const available = useMemo(
    () => browserKeyCandidates({ apiKey, cfToken, cfAccountId, kieApiKey, falApiKey, runwareApiKey, atlasApiKey, cometApiKey, piapiApiKey }),
    [apiKey, atlasApiKey, cfAccountId, cfToken, cometApiKey, piapiApiKey, falApiKey, kieApiKey, runwareApiKey]
  );
  const active = available.filter(key => !imported.has(key.provider));
  if (hasHydrated && active.length === 0) return null;

  function toggle(provider: ImportableProvider) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider); else next.add(provider);
      return next;
    });
  }

  function identityMatches(capturedEpoch: number) {
    const state = useAccountStore.getState();
    return mounted.current && state.epoch === capturedEpoch && state.session?.account?.id === ownerId;
  }

  async function submit() {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(null); setNotice(null);
    const capturedEpoch = epoch;
    let completed = 0;
    let stoppedForIdentity = false;
    const failures: string[] = [];
    try {
      for (const key of active.filter(item => selected.has(item.provider) && !saved.has(item.provider))) {
        if (!identityMatches(capturedEpoch)) { stoppedForIdentity = true; break; }
        try {
          const response = await importBrowserKey(key, ownerId);
          if (!identityMatches(capturedEpoch)) { stoppedForIdentity = true; break; }
          if (response.import.status === 'inserted' || response.import.status === 'skipped') {
            completed++;
            setImported(current => new Set(current).add(key.provider));
            setSelected(current => { const next = new Set(current); next.delete(key.provider); return next; });
          }
        } catch (reason) {
          if (!identityMatches(capturedEpoch)) { stoppedForIdentity = true; break; }
          failures.push(`${labels.get(key.provider) ?? key.provider}: ${reason instanceof Error ? reason.message : 'Could not import this key.'}`);
        }
      }
      if (identityMatches(capturedEpoch) && completed > 0) {
        accountChanged();
        await refreshAccount().catch(() => undefined);
      }
      if (mounted.current && !stoppedForIdentity) {
        if (completed > 0) setNotice(`${completed} browser ${completed === 1 ? 'key' : 'keys'} imported. The original keys remain on this device.`);
        if (failures.length > 0) setError(failures.join(' '));
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <AccountSurface label="Import browser keys" className="mt-5">
    <div className="flex items-start gap-3">
      <span className="rounded-xl border border-cyan-400/25 bg-gradient-to-br from-cyan-400/15 to-violet-400/15 p-2.5 text-cyan-300"><Download size={19} aria-hidden="true" /></span>
      <div><h2 className="text-lg font-semibold">Import browser keys</h2><p className="mt-1 text-sm leading-relaxed text-[var(--foreground-muted)]">Choose local provider keys to encrypt in your account. Originals remain on this device, and existing account connections are skipped.</p></div>
    </div>
    {!hasHydrated ? <p className="mt-5 text-sm text-[var(--foreground-muted)]">Checking this browser for provider keys…</p> : <form className="mt-5" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy} className="space-y-2">
        <legend className="sr-only">Browser keys to import</legend>
        {active.map(key => {
          const alreadySaved = saved.has(key.provider);
          const invalidCloudflare = key.provider === 'cloudflare' && !/^[a-f0-9]{32}$/i.test(key.accountId ?? '');
          return <label key={key.provider} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${alreadySaved ? 'border-[var(--border)] opacity-60' : 'border-[var(--border-hover)] hover:border-cyan-400/35'}`}>
            <input type="checkbox" aria-label={labels.get(key.provider)} checked={selected.has(key.provider)} disabled={alreadySaved || invalidCloudflare} onChange={() => toggle(key.provider)} className="size-4 accent-cyan-400" />
            <span className="min-w-0 flex-1 text-sm font-medium">{labels.get(key.provider)}</span>
            {alreadySaved && <span className="text-xs text-[var(--foreground-muted)]">Already saved</span>}
            {invalidCloudflare && !alreadySaved && <span className="text-xs text-amber-300">Account ID required</span>}
          </label>;
        })}
      </fieldset>
      <button type="submit" disabled={busy || selected.size === 0} className="btn-primary mt-4 w-full"><LockKeyhole size={16} aria-hidden="true" />{busy ? 'Importing…' : 'Import selected'}</button>
    </form>}
    {notice && <p role="status" className="mt-4 text-sm text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
  </AccountSurface>;
}
