// components/WorkspaceHeader.tsx
import type { ReactNode } from 'react';

import ProviderLogo from '@/components/ProviderLogo';
import type { EngineId } from '@/lib/engines/registry';

/**
 * The top row of a provider workspace: back, the engine it runs on, what it
 * makes, and — once a key is connected — a way back to that key.
 *
 * One call to action per state: while the key is missing the ConnectionGate
 * callout below owns it, so the header keeps only the connected-state button
 * rather than repeating the same ask two rows apart.
 */
export default function WorkspaceHeader({
  provider,
  label,
  title,
  description,
  needsKey,
  onBack,
  onOpenConnections,
}: {
  provider: EngineId;
  label: string;
  title: ReactNode;
  description?: ReactNode;
  needsKey: boolean;
  onBack: () => void;
  onOpenConnections: (provider: EngineId) => void;
}) {
  return (
    <section className="glass-card p-3.5 md:p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <button type="button" onClick={onBack} className="btn-secondary shrink-0">
            ← Back
          </button>
          <div className="min-w-0">
            <p className="eyebrow mb-1 flex items-center gap-1.5">
              <ProviderLogo provider={provider} size={13} /> {label}
            </p>
            <h2 className="display text-lg font-semibold text-[var(--foreground)] sm:text-xl">{title}</h2>
            {description && <p className="mt-1 max-w-2xl text-sm text-[var(--foreground-muted)]">{description}</p>}
          </div>
        </div>
        {!needsKey && (
          <button type="button" onClick={() => onOpenConnections(provider)} className="btn-secondary shrink-0">
            {label} key connected
          </button>
        )}
      </div>
    </section>
  );
}
