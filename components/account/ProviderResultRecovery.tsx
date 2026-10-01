'use client';
import { useRef, useState } from 'react';
import { accountRequest } from '@/lib/account/client';
import type { JobResultRecovery } from '@/lib/account/contracts';
import { providerBrowserUrl } from '@/lib/account/result-location';
import { useAccountStore } from '@/store/useAccountStore';

/** Explicit read: temporary provider links never join the account store or get
 * fetched as previews. Each link opens only after the owner chooses it. */
export default function ProviderResultRecovery({ jobId, busy }: { jobId: string; busy: boolean }) {
  const owner = useAccountStore(state => state.session?.account?.id);
  const epoch = useAccountStore(state => state.epoch);
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ owner: string; epoch: number; data: JobResultRecovery } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = result?.owner === owner && result?.epoch === epoch ? result.data : null;

  async function load() {
    if (!owner || pending.current) return;
    const stillOwner = () => {
      const current = useAccountStore.getState();
      return current.epoch === epoch && current.session?.account?.id === owner;
    };
    pending.current = true; setLoading(true); setError(null);
    try {
      const recovery = await accountRequest<JobResultRecovery>(`jobs/${jobId}/recovery`);
      if (stillOwner()) setResult({ owner, epoch, data: recovery });
    } catch (cause) {
      if (stillOwner()) setError(cause instanceof Error ? cause.message : 'Could not retrieve the provider download. Try again.');
    } finally { pending.current = false; setLoading(false); }
  }

  return <div className="mt-2 text-xs leading-relaxed">
    {!data && <button type="button" disabled={busy || loading} onClick={() => void load()} className="text-sky-200 underline underline-offset-4 disabled:opacity-50">{loading ? 'Getting provider download…' : 'Get provider download'}</button>}
    {data && <>
      <p className="text-[var(--foreground-muted)]">{data.links.length ? 'Open the provider’s file and save it to your device. These links may expire. No new generation is started.' : 'The provider did not supply a usable download link. Ask the provider to recover the completed result using the reference below.'}</p>
      <div className="mt-2 flex flex-col items-start gap-2">{data.links.map((link, index) => {
        const url = providerBrowserUrl(link.url);
        return url && <a key={`${index}-${url.href}`} href={url.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="max-w-full break-all text-sky-200 underline underline-offset-4">Open result{data.links.length > 1 ? ` ${index + 1}` : ''} on {url.hostname} ↗</a>;
      })}</div>
      <p className="mt-2 break-all text-[var(--foreground-muted)]">{data.providerTaskId ? 'Provider reference' : 'Scene Assembly job reference'}: <span className="select-all font-mono">{data.providerTaskId ?? jobId}</span></p>
    </>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
  </div>;
}
