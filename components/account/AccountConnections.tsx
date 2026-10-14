'use client';

import { KeyRound } from 'lucide-react';

import ProviderLogo from '@/components/ProviderLogo';
import { ENGINES, type EngineId } from '@/lib/engines/registry';
import { providerAccent } from '@/lib/providers/mark-color';
import { useAccountStore } from '@/store/useAccountStore';

const label = (id: string) => ENGINES.find((engine) => engine.id === id)?.label ?? id;

/**
 * A read-only summary of what the account holds. Managing a key happens in the
 * connections dialog — the same one the workspace opens — so the two surfaces
 * cannot drift, and there is one place to learn.
 *
 * Connections come from the session payload, which already carries them
 * (`cloud/src/index.ts:61`), so this no longer fetches on mount.
 */
export default function AccountConnections({ onManage }: { onManage: () => void }) {
  const connections = useAccountStore((state) => state.session?.connections ?? []);

  return (
    <section aria-label="Saved connections">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Saved connections</span>
        <span className="font-mono text-[10px] tracking-[0.18em] text-[var(--foreground-subtle)]">{connections.length}</span>
      </div>

      {connections.length > 0 ? (
        <ul className="mt-2.5">
          {connections.map((connection) => (
            <li key={connection.id} className="flex items-center gap-2.5 border-b border-[var(--border)] py-2">
              <span className="shrink-0" style={{ color: providerAccent(connection.provider) }}>
                <ProviderLogo provider={connection.provider as EngineId} size={15} />
              </span>
              <p className="min-w-0 truncate text-[13px] font-medium">{label(connection.provider)}</p>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--foreground-subtle)]">··{connection.hint}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--foreground-subtle)]">No provider keys are saved to this account yet.</p>
      )}

      <button type="button" onClick={onManage} className="btn-secondary mt-3 w-full">
        <KeyRound size={15} aria-hidden="true" />Manage connections
      </button>
    </section>
  );
}
